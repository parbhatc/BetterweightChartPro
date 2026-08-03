import { barSourceValue, PRICE_SOURCES } from "../math/source.js";

const SOURCE_IDS = new Set(PRICE_SOURCES.map((source) => source.id));
const FUNCTIONS = new Set(["sma", "ema", "rsi", "highest", "lowest", "change", "abs", "min", "max"]);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)/.exec(rest);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const name = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ type: "name", value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    const char = input[i];
    if ("+-*/%(),".includes(char)) {
      tokens.push({ type: char, value: char });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character "${char}" at position ${i + 1}`);
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

/** Parse a custom-indicator formula into a small, safe syntax tree. */
export function parseIndicatorFormula(formula) {
  const source = String(formula ?? "").trim();
  if (!source) throw new Error("Enter a formula");
  if (source.length > 500) throw new Error("Formula must be 500 characters or fewer");
  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index];
  const take = (type) => {
    const token = peek();
    if (token.type !== type) throw new Error(`Expected "${type}"`);
    index += 1;
    return token;
  };

  function primary() {
    const token = peek();
    if (token.type === "number") {
      index += 1;
      return { type: "number", value: token.value };
    }
    if (token.type === "name") {
      index += 1;
      const name = token.value;
      if (peek().type !== "(") {
        if (!SOURCE_IDS.has(name)) throw new Error(`Unknown data field "${name}"`);
        return { type: "source", name };
      }
      if (!FUNCTIONS.has(name)) throw new Error(`Unknown function "${name}"`);
      take("(");
      const args = [];
      if (peek().type !== ")") {
        do {
          args.push(expression());
          if (peek().type !== ",") break;
          take(",");
        } while (true);
      }
      take(")");
      const expected = ["abs", "change"].includes(name) ? 1 : 2;
      if (args.length !== expected) {
        throw new Error(`${name}() expects ${expected} argument${expected === 1 ? "" : "s"}`);
      }
      if (["sma", "ema", "rsi", "highest", "lowest"].includes(name)) windowLength(args[1]);
      return { type: "call", name, args };
    }
    if (token.type === "(") {
      take("(");
      const node = expression();
      take(")");
      return node;
    }
    throw new Error("Expected a number, price field, or function");
  }

  function unary() {
    if (peek().type === "+" || peek().type === "-") {
      const operator = tokens[index++].type;
      return { type: "unary", operator, value: unary() };
    }
    return primary();
  }

  function multiply() {
    let node = unary();
    while (["*", "/", "%"].includes(peek().type)) {
      const operator = tokens[index++].type;
      node = { type: "binary", operator, left: node, right: unary() };
    }
    return node;
  }

  function expression() {
    let node = multiply();
    while (["+", "-"].includes(peek().type)) {
      const operator = tokens[index++].type;
      node = { type: "binary", operator, left: node, right: multiply() };
    }
    return node;
  }

  const tree = expression();
  if (peek().type !== "eof") throw new Error(`Unexpected token "${peek().value}"`);
  return tree;
}

function valid(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function windowLength(node) {
  if (node.type !== "number" || !Number.isInteger(node.value) || node.value < 1 || node.value > 10000) {
    throw new Error("Function length must be a whole number from 1 to 10000");
  }
  return node.value;
}

function pointwise(left, right, operator) {
  return left.map((a, index) => {
    const b = right[index];
    if (a == null || b == null) return null;
    if ((operator === "/" || operator === "%") && b === 0) return null;
    if (operator === "+") return valid(a + b);
    if (operator === "-") return valid(a - b);
    if (operator === "*") return valid(a * b);
    if (operator === "/") return valid(a / b);
    return valid(a % b);
  });
}

function rolling(values, length, mode) {
  const output = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i += 1) {
    const window = values.slice(i - length + 1, i + 1);
    if (window.some((value) => value == null)) continue;
    if (mode === "sma") output[i] = window.reduce((sum, value) => sum + value, 0) / length;
    else if (mode === "highest") output[i] = Math.max(...window);
    else output[i] = Math.min(...window);
  }
  return output;
}

function ema(values, length) {
  const output = new Array(values.length).fill(null);
  const alpha = 2 / (length + 1);
  let seed = [];
  let previous = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null) {
      seed = [];
      previous = null;
      continue;
    }
    if (previous == null) {
      seed.push(value);
      if (seed.length < length) continue;
      if (seed.length > length) seed.shift();
      previous = seed.reduce((sum, item) => sum + item, 0) / length;
    } else {
      previous = value * alpha + previous * (1 - alpha);
    }
    output[i] = previous;
  }
  return output;
}

function rsi(values, length) {
  const output = new Array(values.length).fill(null);
  if (values.length <= length) return output;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i += 1) {
    if (values[i] == null || values[i - 1] == null) return output;
    const delta = values[i] - values[i - 1];
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= length;
  loss /= length;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  output[length] = value();
  for (let i = length + 1; i < values.length; i += 1) {
    if (values[i] == null || values[i - 1] == null) continue;
    const delta = values[i] - values[i - 1];
    gain = (gain * (length - 1) + Math.max(delta, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-delta, 0)) / length;
    output[i] = value();
  }
  return output;
}

function evaluate(node, bars) {
  if (node.type === "number") return bars.map(() => node.value);
  if (node.type === "source") return bars.map((bar) => valid(barSourceValue(bar, node.name)));
  if (node.type === "unary") {
    const values = evaluate(node.value, bars);
    return node.operator === "-" ? values.map((value) => (value == null ? null : -value)) : values;
  }
  if (node.type === "binary") {
    return pointwise(evaluate(node.left, bars), evaluate(node.right, bars), node.operator);
  }
  const first = evaluate(node.args[0], bars);
  if (node.name === "abs") return first.map((value) => (value == null ? null : Math.abs(value)));
  if (node.name === "change") return first.map((value, i) => i === 0 || value == null || first[i - 1] == null ? null : value - first[i - 1]);
  if (node.name === "min" || node.name === "max") {
    const second = evaluate(node.args[1], bars);
    return first.map((value, i) => value == null || second[i] == null ? null : Math[node.name](value, second[i]));
  }
  const length = windowLength(node.args[1]);
  if (node.name === "ema") return ema(first, length);
  if (node.name === "rsi") return rsi(first, length);
  return rolling(first, length, node.name);
}

/** Compile once, then evaluate against each incoming bar set. No eval/Function is used. */
export function compileIndicatorFormula(formula) {
  const tree = parseIndicatorFormula(formula);
  return (bars) => evaluate(tree, bars);
}
