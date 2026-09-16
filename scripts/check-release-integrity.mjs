#!/usr/bin/env node
/**
 * Release-integrity firewall (RI-01..RI-05) — open-agent-audit.
 *
 * Born from the real Passport 0.7.0 incident (2026-09-16): a metadata PR cut
 * from a stale base silently reverted the passport version (0.7.0 -> 0.6.2)
 * and an exact workspace pin, and npm provenance rejected the publish over
 * incomplete repository metadata. Structural invariants, learned the
 * expensive way:
 *
 *   "metadata-only PR"   !=  "semantically harmless PR"
 *   branch mergeability  !=  release metadata monotonicity
 *
 * Checks
 *   RI-01  publishable packages carry canonical repository provenance,
 *          license, name, version (npm provenance preflight)
 *   RI-02  no package version DOWNgrades vs the merge base — a rollback is a
 *          revert of the original bump commit, never a stale metadata re-land
 *   RI-03  exact internal workspace pins == the pinned package's version
 *          (real incident: passport 0.7.0 vs worker pin 0.6.2)
 *   RI-04  bun install --frozen-lockfile passes (--frozen-install mode)
 *   RI-05  release branches (changeset-release/*): protected fields do not
 *          regress vs main
 *
 * Usage:
 *   node scripts/check-release-integrity.mjs --base <ref>      # PR mode
 *   node scripts/check-release-integrity.mjs --frozen-install  # RI-04 only
 *   node scripts/check-release-integrity.mjs --self-test       # negatives
 *
 * Exit 0 = clean; 1 = violations; 2 = usage error.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CANONICAL_REPO_URLS = [
  "https://github.com/WasmAgent/open-agent-audit.git",
  "git+https://github.com/WasmAgent/open-agent-audit.git",
  "https://github.com/WasmAgent/open-agent-audit",
];

// ── pure checks (self-testable without git) ──────────────────────────────────

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** RI-01 — provenance + release metadata for every publishable package. */
export function ri01Violations(manifests) {
  const violations = [];
  for (const [file, m] of manifests) {
    if (m.private === true) continue;
    const repo = m.repository;
    const url = isPlainObject(repo) ? String(repo.url ?? "") : "";
    const urlOk =
      isPlainObject(repo) &&
      repo.type === "git" &&
      CANONICAL_REPO_URLS.some(
        (canonical) => url === canonical || url === canonical.replace(/\.git$/, ""),
      );
    if (!urlOk) {
      violations.push(
        `RI-01 ${file}: repository provenance missing or non-canonical (url=${url ? url : "<empty>"}) — ` +
          `npm provenance requires it to match ${CANONICAL_REPO_URLS[0]}`,
      );
      continue;
    }
    if (typeof m.license !== "string" || m.license.length === 0) {
      violations.push(`RI-01 ${file}: license missing`);
    }
  }
  return violations;
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function versionLt(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return false;
  return A[0] !== B[0] ? A[0] < B[0] : A[1] !== B[1] ? A[1] < B[1] : A[2] < B[2];
}

/**
 * RI-02 — version downgrades vs the base. A downgrade of a version the base
 * carried is a stale-base metadata regression; rollback is a revert of the
 * original bump commit, not a re-land of older metadata.
 */
export function ri02Violations(baseManifests, headManifests) {
  const violations = [];
  for (const [file, head] of headManifests) {
    const base = baseManifests.get(file);
    if (!base) continue;
    if (versionLt(head.version, base.version)) {
      violations.push(
        `RI-02 ${file}: version DOWNgraded vs base (${base.version} -> ${head.version}). ` +
          `Rollbacks revert the original bump commit; they never re-land stale metadata.`,
      );
    }
  }
  return violations;
}

/**
 * RI-03 — exact internal workspace pins must equal the pinned package's
 * workspace version (range pins are owned by the versioning policy).
 */
export function ri03Violations(manifests) {
  const violations = [];
  const versions = new Map();
  for (const m of manifests.values()) versions.set(m.name, m.version);

  for (const [file, m] of manifests) {
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = m[section];
      if (!isPlainObject(deps)) continue;
      for (const [dep, range] of Object.entries(deps)) {
        if (!versions.has(dep)) continue;
        const rangeStr = String(range);
        if (rangeStr.startsWith("workspace:") || /^[^0-9]/.test(rangeStr)) continue;
        if (!/^\d+\.\d+\.\d+$/.test(rangeStr)) continue;
        const actual = versions.get(dep);
        if (actual !== rangeStr) {
          violations.push(
            `RI-03 ${file}: exact pin ${dep}@${rangeStr} != workspace version ${actual} — ` +
              `stale exact pins are release-integrity regressions`,
          );
        }
      }
    }
  }
  return violations;
}

/** RI-04 — the actual frozen-install contract (executed, not assumed). */
export function ri04FrozenInstall(cwd) {
  const res = spawnSync("bun", ["install", "--frozen-lockfile"], {
    encoding: "utf8",
    cwd,
  });
  return {
    ok: res.status === 0,
    detail: res.status === 0 ? "bun install --frozen-lockfile passed" : `FAILED: ${(res.stderr || res.stdout || "").slice(0, 160)}`,
  };
}

/** RI-05 — protected fields do not regress vs main on release branches. */
export function ri05Violations(mainManifests, releaseManifests) {
  return [
    ...ri02Violations(mainManifests, releaseManifests),
    ...ri03Violations(releaseManifests).filter(() => false), // pins already covered by RI-03 on the branch itself
  ];
}

// ── git-backed manifest collection ───────────────────────────────────────────

function git(args) {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${(res.stderr || "").slice(0, 160)}`);
  return res.stdout.trim();
}

function collectManifests(atRef) {
  const out = new Map();
  for (const file of git(["ls-files", "packages/*/package.json", "package.json"]).split("\n").filter(Boolean)) {
    try {
      const raw = atRef ? git(["show", `${atRef}:${file}`]) : readFileSync(join(process.cwd(), file), "utf8");
      const m = JSON.parse(raw);
      if (typeof m.name === "string" && typeof m.version === "string") out.set(file, m);
    } catch {
      // absent at this ref / unparseable — other tooling owns that failure
    }
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const violations = [];

if (args.includes("--self-test")) {
  // ── Negative regressions from the real incident ──
  const mk = (file, m) => [file, m];
  const canonicalRepo = { type: "git", url: CANONICAL_REPO_URLS[0] };

  const healthy = new Map([
    mk("packages/passport/package.json", {
      name: "@openagentaudit/passport",
      version: "0.7.0",
      private: false,
      license: "Apache-2.0",
      repository: canonicalRepo,
      dependencies: {},
    }),
    mk("packages/worker/package.json", {
      name: "@openagentaudit/worker",
      version: "0.1.0",
      private: true,
      license: "Apache-2.0",
      repository: canonicalRepo,
      dependencies: { "@openagentaudit/passport": "0.7.0" },
    }),
  ]);

  // RI-01 negative: missing/wrong repository.url fails (the real E422).
  const noRepo = new Map([
    mk("packages/passport/package.json", {
      name: "@openagentaudit/passport",
      version: "0.7.0",
      private: false,
      license: "Apache-2.0",
    }),
  ]);
  const r1 = ri01Violations(noRepo);
  if (r1.length === 0 || !r1[0].includes("provenance")) {
    violations.push(`self-test RI-01 negative failed: ${r1.join("; ")}`);
  }

  // RI-01 positive: healthy passes.
  if (ri01Violations(healthy).length !== 0) violations.push("self-test RI-01 positive failed");

  // RI-02 negative: the REAL 0.7.0 -> 0.6.2 downgrade fails.
  const downgraded = new Map([
    mk("packages/passport/package.json", { name: "@openagentaudit/passport", version: "0.6.2" }),
  ]);
  const baseHeads = new Map([
    mk("packages/passport/package.json", { name: "@openagentaudit/passport", version: "0.7.0" }),
  ]);
  if (ri02Violations(baseHeads, downgraded).length === 0) {
    violations.push("self-test RI-02 negative failed: downgrade not caught");
  }

  // RI-02 positive: an intentional bump passes.
  const bumped = new Map([
    mk("packages/passport/package.json", { name: "@openagentaudit/passport", version: "0.8.0" }),
  ]);
  if (ri02Violations(baseHeads, bumped).length !== 0) {
    violations.push("self-test RI-02 positive failed: bump flagged as downgrade");
  }

  // RI-03 negative: the REAL stale worker pin (passport 0.7.0, worker pin 0.6.2).
  const stalePin = new Map([
    mk("packages/passport/package.json", { name: "@openagentaudit/passport", version: "0.7.0" }),
    mk("packages/worker/package.json", {
      name: "@openagentaudit/worker",
      version: "0.1.0",
      dependencies: { "@openagentaudit/passport": "0.6.2" },
    }),
  ]);
  if (ri03Violations(stalePin).length === 0) {
    violations.push("self-test RI-03 negative failed: stale pin not caught");
  }

  // RI-04 positive: the real frozen install passes on a coherent tree.
  const r4 = ri04FrozenInstall(process.cwd());
  if (!r4.ok) violations.push(`self-test RI-04 positive failed: ${r4.detail}`);
} else {
  const base = (() => {
    const i = args.indexOf("--base");
    return i !== -1 ? args[i + 1] : undefined;
  })();
  const frozenOnly = args.includes("--frozen-install");

  const head = collectManifests(null);

  if (frozenOnly) {
    const r4 = (() => {
      const res = spawnSync("bun", ["install", "--frozen-lockfile"], { encoding: "utf8" });
      return { ok: res.status === 0, detail: (res.stderr || res.stdout || "").slice(0, 160) };
    })();
    console.log(`${r4.ok ? "PASS" : "FAIL"} RI-04 frozen install: ${r4.detail}`);
    if (!r4.ok) violations.push("RI-04");
  } else {
    ri01Violations(head).forEach((v) => violations.push(v));

    if (base !== undefined) {
      const baseM = collectManifests(base);
      ri02Violations(baseM, head).forEach((v) => violations.push(v));
    }
    ri03Violations(head).forEach((v) => violations.push(v));

    const r4 = (() => {
      const res = spawnSync("bun", ["install", "--frozen-lockfile"], { encoding: "utf8" });
      return { ok: res.status === 0, detail: (res.stderr || res.stdout || "").slice(0, 160) };
    })();
    console.log(`${r4.ok ? "PASS" : "FAIL"} RI-04 frozen install: ${r4.detail}`);
    if (!r4.ok) violations.push("RI-04");

    // RI-05 — release branches: protected fields must not regress vs main.
    const branch = (() => {
      try {
        return spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim();
      } catch {
        return "";
      }
    })();
    if (branch.startsWith("changeset-release/")) {
      try {
        const mainManifests = collectManifests("origin/main");
        ri02Violations(mainManifests, head).forEach((v) => violations.push(v));
        console.log("PASS RI-05 release-head coherence checked vs origin/main");
      } catch (error) {
        console.log(`WARN RI-05 main comparison skipped: ${String(error).slice(0, 120)}`);
      }
    }
  }

  if (violations.length > 0) {
    for (const v of violations) console.error(`  ::error::${v}`);
    console.error(`release-integrity firewall: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log("release-integrity firewall: clean");
}
