import random

from acme.services.ecg import ecg_strip
from acme.services.engine import MonitorSim, effective_limits, evaluate, reconcile, step

LIMITS = {"hr": {"low": 50, "high": 120, "enabled": True}, "spo2": {"low": 90, "high": None, "enabled": True},
          "rr": {"low": 8, "high": 28, "enabled": True}, "sbp": {"low": 90, "high": 160, "enabled": True},
          "dbp": {"low": 50, "high": 100, "enabled": True}}


def run(sim: MonitorSim, ticks: int, active: dict | None = None):
    active = {} if active is None else active
    reading = None
    for i in range(ticks):
        res = step(sim, random.Random(i), 5)
        reading = res.reading
        conds, evaluated = evaluate(sim, reading, LIMITS, active_types=set(active))
        raise_, refresh, clear = reconcile(active, conds, evaluated)
        for c in raise_:
            active[c.type] = {"type": c.type, "acknowledged_at": None, "priority": c.priority}
        for t in clear:
            active.pop(t)
    return reading, active


def new_sim(scenario="normal"):
    return MonitorSim(monitor_id="m1", scenario=scenario, battery=100, patient_id="p1", bed_id="b1")


def test_normal_readings_stay_in_range_and_raise_nothing():
    reading, active = run(new_sim(), 60)
    assert 60 < reading["hr"] < 100 and reading["spo2"] >= 93
    assert active == {}


def test_low_spo2_raises_physiological_alarm():
    reading, active = run(new_sim("low_spo2"), 30)
    assert reading["spo2"] < 90
    assert "spo2_low" in active and active["spo2_low"]["priority"] == "high"


def test_acknowledge_does_not_clear_ongoing_condition():
    sim = new_sim("low_spo2")
    _, active = run(sim, 30)
    active["spo2_low"]["acknowledged_at"] = "2026-11-10T10:00:00Z"
    _, active = run(sim, 10, active)
    assert "spo2_low" in active  # still active although acknowledged
    sim.scenario = "normal"
    _, active = run(sim, 40, active)
    assert "spo2_low" not in active  # cleared only after the condition resolved


def test_low_battery_and_recovery():
    sim = new_sim("low_battery")
    _, active = run(sim, 40)
    assert "battery_low" in active and sim.battery < 20
    sim.scenario = "normal"
    _, active = run(sim, 30, active)
    assert "battery_low" not in active


def test_sensor_fault_hides_spo2_and_keeps_spo2_alarm_state():
    sim = new_sim("low_spo2")
    _, active = run(sim, 30)
    sim.scenario = "sensor_fault"
    reading, active = run(sim, 5, active)
    assert reading["spo2"] is None
    assert "sensor_fault" in active
    assert "spo2_low" in active  # missing data is not proof the desaturation ended


def test_connection_loss_produces_no_reading():
    sim = new_sim("connection_loss")
    reading, active = run(sim, 3)
    assert reading is None and "connection_lost" in active
    sim.scenario = "normal"
    reading, active = run(sim, 2, active)
    assert reading is not None and "connection_lost" not in active


def test_patient_override_wins():
    lim = effective_limits({"spo2": {"low": 90, "high": None}}, {"spo2": {"low": 88, "high": None}})
    assert lim["spo2"]["low"] == 88


def test_ecg_strip_shape():
    s = ecg_strip(75, seconds=4, fs=125)
    assert len(s) == 500 and max(s) > 0.8  # R peaks present
    flat = ecg_strip(None, quality="lead_off")
    assert max(abs(v) for v in flat) < 0.1


def test_hysteresis_prevents_flapping():
    sim = new_sim()
    sim.patient_id = "p1"
    reading = {"hr": 80, "spo2": 89.5, "rr": 16, "sbp": 120, "dbp": 70}
    conds, _ = evaluate(sim, reading, LIMITS)
    assert any(c.type == "spo2_low" for c in conds)
    reading["spo2"] = 90.5  # back above the limit but inside the hysteresis band
    conds, _ = evaluate(sim, reading, LIMITS, active_types={"spo2_low"})
    assert any(c.type == "spo2_low" for c in conds)
    reading["spo2"] = 91.5
    conds, _ = evaluate(sim, reading, LIMITS, active_types={"spo2_low"})
    assert not any(c.type == "spo2_low" for c in conds)
