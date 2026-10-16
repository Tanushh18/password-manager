import fs from 'node:fs';

const [mode, reportPath, policyPath] = process.argv.slice(2);
if (!['npm', 'trivy'].includes(mode) || !reportPath || !policyPath) {
  console.error('Usage: node security-exception-gate.mjs <npm|trivy> <report.json|sarif> <exceptions.json>');
  process.exit(2);
}

function fail(message) {
  console.error(`SECURITY GATE FAILED: ${message}`);
  process.exitCode = 1;
}

let report;
let policy;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
} catch (error) {
  fail(`cannot read report/policy: ${error.message}`);
  process.exit();
}

const today = new Date().toISOString().slice(0, 10);
const exceptions = Array.isArray(policy.exceptions) ? policy.exceptions : [];
const validExceptions = new Map();
for (const exception of exceptions) {
  if (!exception.package || !Array.isArray(exception.advisoryIds, || !exception.expiresAt || !exception.approvedBy) {
    fail('malformed exception entry');
    continue;
  }
  if (exception.expiresAt < today) {
    fail(`exception expired: ${exception.package} (${exception.advisoryIds.join(', ')}) expired ${exception.expiresAt}`);
    continue;
  }
  for (const id of exception.advisoryIds) {
    validExceptions.set(`${exception.package.toLowerCase()}|${id.toUpperCase()}`, exception);
  }
}

function exceptionFor(packageName, advisoryIds) {
  return advisoryIds.some(id => validExceptions.has(`${String(packageName).toLowerCase()}|${String(id).toUpperCase()}`));
}

if (mode === 'npm') {
  if (!report.vulnerabilities || !report.metadata?.vulnerabilities) {
    fail('npm audit report is incomplete (registry/network/command failure); refusing to treat it as clean');
    process.exit();
  }
  const vulnerabilities = report.vulnerabilities ?? {};
  const highOrCritical = Object.entries(vulnerabilities).filter(([, v]) => ['high', 'critical'].includes(String(v.severity).toLowerCase()));
  const errors = [];
  const unresolved = new Set();

  function collectHighAdvisories(packageName, stack = new Set()) {
    if (stack.has(packageName)) return { ids: new Set(), bad: [] };
    const entry = vulnerabilities[packageName];
    if (!entry) return { ids: new Set(), bad: [`unresolved dependency ${packageName}`] };
    const nextStack = new Set(stack).add(packageName);
    const ids = new Set();
    const bad = [];
    for (const via of entry.via ?? []) {
      if (typeof via === 'string') {
        const nested = collectHighAdvisories(via, nextStack);
        nested.ids.forEach(id => ids.add(id));
        bad.push(...nested.bad);
      } else if (via && typeof via === 'object') {
        const severity = String(via.severity ?? entry.severity).toLowerCase();
        if (!['high', 'critical'].includes(severity)) continue;
        const idsForAdvisory = new Set();
        if (via.url) {
          const match = String(via.url).match(/(GHSA-[0-9A-Z-]+|CVE-\d{4}-\d+)/ig);
          if (match) match.forEach(id => idsForAdvisory.add(id.toUpperCase()));
        }
        if (via.source) idsForAdvisory.add(String(via.source).toUpperCase());
        const advisoryPackage = String(via.name ?? packageName).toLowerCase();
        if (!idsForAdvisory.size || !exceptionFor(advisoryPackage, [...idsForAdvisory])) {
          bad.push(`${advisoryPackage} advisory ${[...idsForAdvisory].join('/') || '(missing id)'} is not excepted`);
        } else {
          for (const id of idsForAdvisory) {
            if ([...validExceptions.keys()].some(key => key.startsWith(`${advisoryPackage}|`) && key.endsWith(`|${id}`))) ids.add(`${advisoryPackage}|${id}`);
          }
        }
      } else {
        bad.push(`unrecognized advisory entry for ${packageName}`);
      }
    }
    return { ids, bad };
  }

  for (const [name, vulnerability] of highOrCritical) {
    const result = collectHighAdvisories(name);
    if (result.bad.length || result.ids.size === 0) {
      errors.push(`${name} (${vulnerability.severity}): ${[...result.bad, ...(result.ids.size ? [] : ['no approved high/critical advisory root found'])].join('; ')}`);
    }
  }

  if (errors.length) {
    console.error(`Found ${errors.length} unapproved high/critical npm audit entries:`);
    errors.forEach(error => console.error(` - ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`npm audit policy passed: ${highOrCritical.length} high/critical package-chain entries are attributable only to active, exact package/advisory exceptions.`);
    console.log(`Exceptions expire no later than ${exceptions.map(e => e.expiresAt).sort()[0] ?? 'none'}.`);
  }
} else {
  const results = (report.runs ?? []).flatMap(run => run.results ?? []);
  const findings = results.filter(result => {
    const level = String(result.level ?? '').toLowerCase();
    const rule = (report.runs ?? []).flatMap(run => run.tool?.driver?.rules ?? []).find(r => r.id === result.ruleId);
    const tags = (rule?.properties?.tags ?? []).map(tag => String(tag).toUpperCase());
    if (tags.includes('LOW') || tags.includes('MEDIUM')) return false;
    const severity = String(rule?.properties?.severity ?? '').toLowerCase();
    return ['error', 'warning'].includes(level) || ['high', 'critical'].includes(severity) || tags.includes('HIGH') || tags.includes('CRITICAL');
  });
  const unapproved = [];
  for (const finding of findings) {
    const text = String(finding.message?.text ?? '');
    const packageMatch = text.match(/Package:\s*([^\r\n]+)/i);
    const packageName = packageMatch?.[1]?.trim();
    const ids = [finding.ruleId, ...[...text.matchAll(/\b(?:CVE-\d{4}-\d+|GHSA-[0-9A-Z-]+)\b/ig)].map(match => match[0])].filter(Boolean).map(value => String(value).toUpperCase());
    if (!packageName || !exceptionFor(packageName, ids)) unapproved.push(`${finding.ruleId ?? '(unknown rule)'}: ${text.split('\n')[0]}`);
    else console.log(`Accepted time-limited exception: ${packageName} ${ids.join(', ')}`);
  }
  if (unapproved.length) {
    console.error(`Found ${unapproved.length} unapproved Trivy findings:`);
    unapproved.forEach(finding => console.error(` - ${finding}`));
    process.exitCode = 1;
  } else {
    console.log(`Trivy policy passed: ${findings.length} finding(s) matched active exact exceptions; the SARIF report remains uploaded and visible.`);
  }
}
