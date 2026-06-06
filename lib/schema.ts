import Ajv, { type ErrorObject } from "ajv";
import schema from "../schema/screenplay.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  errors: FormattedError[];
}

export interface FormattedError {
  path: string;
  message: string;
  keyword: string;
}

function formatError(err: ErrorObject): FormattedError {
  const path = err.instancePath || "(root)";
  let message = err.message ?? "校验失败";
  if (err.keyword === "additionalProperties" && err.params?.additionalProperty) {
    message = `不允许的额外字段：${err.params.additionalProperty}`;
  }
  if (err.keyword === "enum" && Array.isArray((err.params as any)?.allowedValues)) {
    message = `取值必须是：${(err.params as any).allowedValues.join(" / ")}`;
  }
  if (err.keyword === "required" && (err.params as any)?.missingProperty) {
    message = `缺少必填字段：${(err.params as any).missingProperty}`;
  }
  return { path, message, keyword: err.keyword };
}

/** 校验任意对象是否符合剧本 Schema。 */
export function validateScreenplay(data: unknown): ValidationResult {
  const valid = validateFn(data) as boolean;
  const errors = (validateFn.errors ?? []).map(formatError);
  return { valid, errors };
}

export { schema as screenplaySchema };
