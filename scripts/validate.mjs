#!/usr/bin/env node
// 独立的 YAML 剧本 Schema 校验脚本（不依赖 Next/构建）。
// 用法：node scripts/validate.mjs [path-to.yaml]
// 默认校验 examples/sample-screenplay.yaml。退出码：通过 0，失败 1。

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv";
import YAML from "yaml";

const root = process.cwd();
const schemaPath = path.join(root, "schema", "screenplay.schema.json");
const target = process.argv[2] || path.join("examples", "sample-screenplay.yaml");
const targetPath = path.isAbsolute(target) ? target : path.join(root, target);

function fail(msg) {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) fail(`找不到 Schema：${schemaPath}`);
if (!fs.existsSync(targetPath)) fail(`找不到待校验文件：${targetPath}`);

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

let data;
try {
  data = YAML.parse(fs.readFileSync(targetPath, "utf-8"));
} catch (e) {
  fail(`YAML 解析失败：${e.message}`);
}

const ok = validate(data);
if (ok) {
  console.log(`\x1b[32m✓ PASS\x1b[0m ${target} 符合剧本 Schema。`);
  process.exit(0);
}

console.error(`\x1b[31m✗ FAIL\x1b[0m ${target} 不符合剧本 Schema：`);
for (const err of validate.errors ?? []) {
  const where = err.instancePath || "(root)";
  console.error(`  - ${where} ${err.message}`);
}
process.exit(1);
