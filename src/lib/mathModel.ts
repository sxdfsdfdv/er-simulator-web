/**
 * Analytical M/M/s queueing theory calculations based on Erlang-C.
 */

import { MMSResult } from './types';

/**
 * Calculates theoretical M/M/s queueing metrics.
 */
export function mmsMetrics(lam: number, mu: number, s: number): MMSResult {
  if (lam <= 0 || mu <= 0 || s < 1) {
    throw new Error(`Invalid parameters: lam=${lam}, mu=${mu}, s=${s}`);
  }

  const a = lam / mu;
  const rho = a / s;

  if (rho >= 1.0) {
    return {
      s,
      rho,
      stable: false,
      Pw: null,
      Wq: null,
      W: null,
      Lq: null,
      L: null,
    };
  }

  // Calculate Poisson PMFs iteratively up to s
  // pmf_0 = exp(-a)
  // pmf_k = pmf_{k-1} * (a / k)
  let pmfK = Math.exp(-a);
  let cdfS1 = 0.0; // sum_{k=0}^{s-1} pmf_k

  for (let k = 0; k < s; k++) {
    cdfS1 += pmfK;
    pmfK = pmfK * (a / (k + 1));
  }
  const pmfS = pmfK; // pmf of s

  const tail = pmfS / (1.0 - rho);
  const denom = cdfS1 + tail;
  const Pw = denom > 0 ? Math.min(1.0, Math.max(0.0, tail / denom)) : 0.0;

  const Lq = Pw * (rho / (1.0 - rho));
  const Wq = Lq / lam; // in hours
  const W = Wq + 1.0 / mu; // in hours
  const L = lam * W;

  return {
    s,
    rho,
    stable: true,
    Pw,
    Wq,
    W,
    Lq,
    L,
  };
}

/**
 * Sweeps staffing levels to evaluate trade-off curve data.
 */
export function sweepServers(lam: number, mu: number, sRange: number[]): MMSResult[] {
  return sRange.map((s) => mmsMetrics(lam, mu, s));
}

/**
 * Finds minimum server count satisfying target waiting time and max utilization cap.
 */
export function recommendStaff(
  lam: number,
  mu: number,
  targetWqMin: number,
  rhoCap = 0.85,
  sMax = 30
): number | null {
  const targetWqHours = targetWqMin / 60.0;
  for (let s = 1; s <= sMax; s++) {
    const res = mmsMetrics(lam, mu, s);
    if (res.stable && res.rho <= rhoCap && res.Wq !== null && res.Wq <= targetWqHours) {
      return s;
    }
  }
  return null;
}
