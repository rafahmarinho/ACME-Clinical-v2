import { format, parseISO } from "date-fns";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PARAM_META } from "../../lib/format";
import type { Limit, Param, TrendPoint } from "../../types";

export function TrendChart({ data, params, limits, height = 180 }: { data: TrendPoint[]; params: Param[]; limits?: Partial<Record<Param, Limit>>; height?: number }) {
  const single = params.length === 1 ? params[0] : null;
  const lim = single && limits?.[single];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#e8eef8" vertical={false} />
        <XAxis
          dataKey="recorded_at"
          tickFormatter={(v: string) => format(parseISO(v), "HH:mm")}
          minTickGap={40}
          tick={{ fontSize: 11, fill: "#4a68a8" }}
          axisLine={{ stroke: "#cdd7ea" }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: "#4a68a8" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={44} />
        <Tooltip
          labelFormatter={(v) => format(parseISO(String(v)), "HH:mm:ss")}
          contentStyle={{ borderRadius: 8, border: "1px solid #cdd7ea", fontSize: 12, color: "#0b1f44" }}
          formatter={(value, name) => [`${value} ${PARAM_META[name as Param]?.unit ?? ""}`, PARAM_META[name as Param]?.short ?? name]}
        />
        {lim && lim.enabled && lim.low != null && <ReferenceLine y={lim.low} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.6} />}
        {lim && lim.enabled && lim.high != null && <ReferenceLine y={lim.high} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.6} />}
        {params.map((p) => (
          <Line key={p} type="monotone" dataKey={p} stroke={PARAM_META[p].color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
