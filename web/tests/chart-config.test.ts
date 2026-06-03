import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeChartJsConfig, parseChartJsConfig } from "../lib/chart-config";

const SAMPLE_JS_CONFIG = `{
  type: "bar",
  data: {
    labels: ["A", "B"],
    datasets: [
      {
        label: "Cost",
        data: [1, 2],
        backgroundColor: ["#4e79a7", "#59a14f"]
      }
    ]
  },
  options: {
    plugins: {
      tooltip: {
        callbacks: {
          label: context => \`₹\${context.parsed.y}\`
        }
      }
    }
  }
}`;

test("parseChartJsConfig handles JS literals with arrow functions", () => {
  const withComments = SAMPLE_JS_CONFIG.replace(
    'backgroundColor: ["#4e79a7", "#59a14f"]',
    'backgroundColor: ["#4e79a7", "#59a14f"] // colors',
  );
  const parsed = parseChartJsConfig(withComments);
  assert.ok(parsed);
  assert.equal(parsed?.type, "bar");
  assert.deepEqual((parsed?.data as { labels: string[] }).labels, ["A", "B"]);
});

test("parseChartJsConfig handles strict JSON", () => {
  const parsed = parseChartJsConfig(
    '{"type":"line","data":{"labels":["x"],"datasets":[{"data":[1]}]}}',
  );
  assert.equal(parsed?.type, "line");
});

test("parseChartJsConfig rejects invalid input", () => {
  assert.equal(parseChartJsConfig(""), null);
  assert.equal(parseChartJsConfig("not a chart"), null);
});

test("looksLikeChartJsConfig detects JS-style configs", () => {
  assert.equal(looksLikeChartJsConfig(SAMPLE_JS_CONFIG), true);
});
