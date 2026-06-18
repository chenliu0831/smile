/**
 * Stand-in data for chart `dataRef`s in the mock run. In the real daemon these
 * arrive as Arrow IPC frames (ADR-0002); here we serve plain column maps that the
 * chart layer adapts the same way it will adapt decoded Arrow.
 */
export type ColumnTable = Record<string, (number | string)[]>;

const rocPoints = Array.from({ length: 21 }, (_, i) => i / 20);
// A plausible concave ROC curve.
const tpr = rocPoints.map((f) => Math.min(1, Math.pow(f, 0.35)));

export const MOCK_TABLES: Record<string, ColumnTable> = {
  "arrow-roc": { fpr: rocPoints, tpr },
  "arrow-confusion": {
    predicted: ["No", "Yes", "No", "Yes"],
    actual: ["No", "No", "Yes", "Yes"],
    count: [4130, 444, 421, 1448],
  },
  "arrow-shap": {
    feature: ["Contract", "tenure", "MonthlyCharges", "InternetService", "TotalCharges", "PaymentMethod"],
    importance: [0.31, 0.27, 0.14, 0.09, 0.07, 0.05],
  },
  "arrow-corr": {
    feature_x: ["tenure", "tenure", "MonthlyCharges"],
    feature_y: ["MonthlyCharges", "Churn", "Churn"],
    corr: [0.25, -0.35, 0.19],
  },
};

export function mockTable(ref: string): ColumnTable | undefined {
  return MOCK_TABLES[ref];
}
