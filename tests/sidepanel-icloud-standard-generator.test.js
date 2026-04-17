const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('sidepanel supports icloud standard alias generator selection and ui copy', () => {
  const bundle = [
    extractFunction('getSelectedEmailGenerator'),
    extractFunction('getEmailGeneratorUiCopy'),
  ].join('\n');

  const api = new Function(`
const selectEmailGenerator = { value: 'icloud-standard-alias' };
function getCustomMailProviderUiCopy() {
  return {
    buttonLabel: '自定义邮箱',
    placeholder: '请填写本轮要使用的注册邮箱',
    successVerb: '使用',
    label: '自定义邮箱',
  };
}
${bundle}
return { getSelectedEmailGenerator, getEmailGeneratorUiCopy };
`)();

  assert.equal(api.getSelectedEmailGenerator(), 'icloud-standard-alias');
  assert.deepEqual(api.getEmailGeneratorUiCopy(), {
    buttonLabel: '获取',
    placeholder: '点击获取普通 iCloud 别名邮箱，或手动粘贴邮箱',
    successVerb: '获取',
    label: '普通 iCloud 别名邮箱',
  });
});

test('sidepanel html exposes icloud standard alias generator option', () => {
  const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');

  assert.match(html, /<option value="icloud-standard-alias">普通 iCloud 别名邮箱<\/option>/);
});

