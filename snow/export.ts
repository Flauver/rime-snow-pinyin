// 本程序基于拼写规则和固顶词码表来模拟实际输入时的动态码长
// 生成的码表可以用于评测和大竹查询

import { readFileSync, writeFileSync } from "fs";
import { load } from "js-yaml";
import { sortBy } from "lodash-es";

function getFixedCode(file: string) {
  const fixed = readFileSync(file, "utf8").trim().split("\n");
  const fixedMap = new Map<string, string>();
  for (const line of fixed) {
    if (line.startsWith("#")) continue;
    let [code, words] = line.split("\t");
    fixedMap.set(code, words.split(" ")[0]!);
  }
  return fixedMap;
}

function getWordsInfo() {
  const singleRaw = readFileSync("snow_pinyin.dict.yaml", "utf8")
    .trim()
    .split("\n");
  const base = readFileSync("snow_pinyin.base.dict.yaml", "utf8")
    .trim()
    .split("\n");
  const ext = readFileSync("snow_pinyin.ext.dict.yaml", "utf8")
    .trim()
    .split("\n");
  const tencent = readFileSync("snow_pinyin.tencent.dict.yaml", "utf8")
    .trim()
    .split("\n");
  const wordTotalWeight = new Map<string, number>();
  const process = (list: string[]) => {
    const info: {
      word: string;
      reading: string;
      weight: number;
      importance: number;
    }[] = [];
    for (const line of list) {
      if (line.startsWith("#")) continue;
      if (!line.includes("\t")) continue;
      const [word, reading, weight_s] = line.split("\t");
      if (/^[a-zA-Z0-9]/.test(word)) continue;
      const weight = parseInt(weight_s ?? "0");
      info.push({ word, reading, weight, importance: 0 });
      wordTotalWeight.set(word, (wordTotalWeight.get(word) ?? 0) + weight);
    }
    return sortBy(info, (x) => -x.weight);
  };
  const single = process(singleRaw).slice(0, maxSingle);
  const multiple = process(base)
    .concat(process(ext), process(tencent))
    .slice(0, maxMultiple);
  const all = single.concat(multiple);
  all.forEach((x) => {
    x.importance = x.weight / wordTotalWeight.get(x.word)!;
  });
  return all;
}

interface Replace {
  from: RegExp;
  to: string;
}

function getSpellingAlgebra() {
  const content = readFileSync("snow_sipin.schema.yaml", "utf8");
  const yaml = load(content) as Record<string, any>;
  const rules: string[] = yaml["sipin_algebra"];
  const parsed: Replace[] = [];
  rules.forEach((rule) => {
    const trimmed = rule.trim();
    const ruleParts = trimmed.split(trimmed.at(-1)!);
    if (ruleParts[0] === "xform" || ruleParts[0] === "derive") {
      parsed.push({
        from: new RegExp(ruleParts[1], "g"),
        to: ruleParts[2],
      });
    } else if (ruleParts[0] === "xlit") {
      const fromList = [...ruleParts[1]];
      const toList = [...ruleParts[2]];
      fromList.forEach((from, i) => {
        parsed.push({
          from: new RegExp(from, "g"),
          to: toList[i],
        });
      });
    }
  });
  parsed.push({ from: /^([a-z]{3})$/g, to: "$1o" });
  return parsed;
}

function spellingAlgebra(code: string, rules: Replace[]) {
  let final = code;
  for (const rule of rules) {
    final = final.replaceAll(rule.from, rule.to);
  }
  return final;
}

/**
 * 得到全码
 */
function assemble(syllables: string[], rules: Replace[]) {
  const transformed = syllables.map((x) => spellingAlgebra(x, rules));
  if (transformed.length === 1) return transformed[0];
  let base = transformed
    .map((x, i) => (useCapital && i >= 4 ? x[0].toUpperCase() : x[0]))
    .join("");
  base += transformed.at(-1)!.slice(1, 3);
  base += transformed[0]!.slice(1, 3);
  return base;
}

function simulate() {
  const fixedMenu = getFixedCode("snow_sipin.fixed.txt");
  const mainMenu = new Map<string, string>();
  const codes = getWordsInfo();
  const rules = getSpellingAlgebra();
  const finalize = (s: string) =>
    /^[bpmfdtnlgkhjqxzcsrwyv]{1,3}$/.test(s) ? s + "_" : s;
  const encoded: { word: string; code: string; importance: number }[] = [];
  for (const { word, reading, importance } of codes) {
    if (word === "的") {
      encoded.push({ word, code: ";", importance });
      continue;
    } else if (word === "了") {
      encoded.push({ word, code: "/", importance });
      continue;
    }
    const syllables = reading.split(" ");
    const full = assemble(syllables, rules);
    let short: string | undefined = undefined;
    for (let i = syllables.length; i != full.length; i++) {
      const maybeShort = full.slice(0, i);
      const maybeFixed = fixedMenu.get(maybeShort);
      const maybeMain = mainMenu.get(maybeShort);
      if (maybeFixed) {
        if (maybeFixed === word) {
          short = maybeShort;
          break;
        } else {
          continue;
        }
      } else if (maybeMain === undefined || maybeMain === word) {
        short = maybeShort;
        mainMenu.set(maybeShort, word);
        break;
      } else {
        continue;
      }
    }
    const code = short ? finalize(short) : full;
    encoded.push({ word, code, importance });
  }
  // 去除编码列表中的重复项，重要度累加
  const codeMap = new Map<string, number>();
  for (const { word, code, importance } of encoded) {
    const hash = `${word}\t${code}`;
    codeMap.set(hash, (codeMap.get(hash) ?? 0) + importance);
  }
  const deduped = [...codeMap].map(([hash, importance]) => {
    const [word, code] = hash.split("\t");
    return { word, code, importance };
  });
  return deduped;
}

const maxSingle = 8773;
const maxMultiple = 60000;
const useCapital = true;
const encoded = simulate();

const finalized: { word: string; code: string; importance: number }[] = [];
for (const { word, code, importance } of encoded) {
  const final = code.replaceAll("_", "").slice(0, 4);
  if (final.includes(";") || final.includes("/")) continue;
  finalized.push({ word, code: final, importance });
}
writeFileSync(
  "simulated.txt",
  finalized
    .map(
      ({ word, code, importance }) =>
        `${word}\t${[...code].join(" ")}\t${Math.round(importance * 100)}`
    )
    .join("\n"),
  "utf8"
);

writeFileSync(
  "dazhu.txt",
  encoded.map(({ word, code }) => `${code}\t${word}`).join("\n"),
  "utf8"
);
