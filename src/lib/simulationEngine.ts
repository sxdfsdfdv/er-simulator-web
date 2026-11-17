/**
 * High-speed Discrete-Event Simulation (DES) Engine for ER Queueing.
 * Implements tandem queue network: Patient Arrival -> [Beds] -> Nurse -> Doctor -> Depart.
 */

import { PatientRecord, SimConfig, SimulationResult, SimulationSummary, TimeSeriesEvent } from './types';

// Fast seeded pseudo-random number generator (Mulberry32)
class SeededRNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  exponential(rate: number): number {
    const u = Math.max(1e-12, this.next());
    return -Math.log(u) / rate;
  }
}

interface EventItem {
  time: number;
  type: string;
  patientId: number;
  data?: any;
}

// Min-heap Priority Queue for simulation event scheduling
class PriorityQueue {
  private heap: EventItem[] = [];

  push(item: EventItem) {
    this.heap.push(item);
    this._up(this.heap.length - 1);
  }

  pop(): EventItem | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._down(0);
    }
    return top;
  }

  get length() {
    return this.heap.length;
  }

  private _up(idx: number) {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.heap[idx].time < this.heap[parent].time) {
        const tmp = this.heap[idx];
        this.heap[idx] = this.heap[parent];
        this.heap[parent] = tmp;
        idx = parent;
      } else {
        break;
      }
    }
  }

  private _down(idx: number) {
    const n = this.heap.length;
    while (true) {
      const left = (idx << 1) + 1;
      const right = left + 1;
      let smallest = idx;
      if (left < n && this.heap[left].time < this.heap[smallest].time) smallest = left;
      if (right < n && this.heap[right].time < this.heap[smallest].time) smallest = right;
      if (smallest !== idx) {
        const tmp = this.heap[idx];
        this.heap[idx] = this.heap[smallest];
        this.heap[smallest] = tmp;
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

interface SingleRunResult {
  patients: PatientRecord[];
  events: TimeSeriesEvent[];
  summary: SimulationSummary;
}

function runSingleReplication(cfg: SimConfig, rng: SeededRNG): SingleRunResult {
  const pq = new PriorityQueue();
  let now = 0;

  // Resource state
  let busyDocs = 0;
  let busyNurses = 0;
  let busyBeds = 0;

  // Queues (patient IDs)
  const bedQueue: number[] = [];
  const nurseQueue: number[] = [];
  const docQueue: number[] = [];

  // Patient data tracker
  const patientMap = new Map<number, Partial<PatientRecord>>();
  const completedPatients: PatientRecord[] = [];

  // Time-series tracker
  const rawEvents: TimeSeriesEvent[] = [];
  const recordEvent = () => {
    rawEvents.push({
      time: now,
      qNurse: nurseQueue.length,
      nNurse: busyNurses,
      qDoc: docQueue.length,
      nDoc: busyDocs,
      bedsInUse: busyBeds,
    });
  };

  recordEvent();

  // Schedule first arrival
  let patientCounter = 0;
  const scheduleNextArrival = () => {
    const ia = rng.exponential(cfg.arrivalRate);
    const arrTime = now + ia;
    if (arrTime < cfg.simHours) {
      patientCounter++;
      pq.push({ time: arrTime, type: 'ARRIVAL', patientId: patientCounter });
    }
  };
  scheduleNextArrival();

  // Try dispatching waiting patients
  const tryStartNurse = () => {
    while (nurseQueue.length > 0 && busyNurses < cfg.numNurses) {
      const pid = nurseQueue.shift()!;
      busyNurses++;
      const p = patientMap.get(pid)!;
      p.nurseServiceStart = now;
      p.nurseWaitMin = (now - (p.nurseQueueEnter || now)) * 60.0;

      const duration = rng.exponential(cfg.nurseMu);
      pq.push({ time: now + duration, type: 'NURSE_END', patientId: pid });
      recordEvent();
    }
  };

  const tryStartDoctor = () => {
    while (docQueue.length > 0 && busyDocs < cfg.numDoctors) {
      const pid = docQueue.shift()!;
      busyDocs++;
      const p = patientMap.get(pid)!;
      p.doctorServiceStart = now;
      p.doctorWaitMin = (now - (p.doctorQueueEnter || now)) * 60.0;

      const duration = rng.exponential(cfg.doctorMu);
      pq.push({ time: now + duration, type: 'DOCTOR_END', patientId: pid });
      recordEvent();
    }
  };

  const tryAcquireBed = () => {
    if (cfg.numBeds === null) return;
    while (bedQueue.length > 0 && busyBeds < cfg.numBeds) {
      const pid = bedQueue.shift()!;
      busyBeds++;
      const p = patientMap.get(pid)!;
      p.bedAcquiredTime = now;
      // Now enters nursing queue
      p.nurseQueueEnter = now;
      nurseQueue.push(pid);
      recordEvent();
      tryStartNurse();
    }
  };

  // Main event loop
  while (pq.length > 0) {
    const event = pq.pop()!;
    now = event.time;

    if (event.type === 'ARRIVAL') {
      const pid = event.patientId;
      patientMap.set(pid, {
        patientId: pid,
        arrivalTime: now,
        bedAcquiredTime: now,
      });

      // Schedule subsequent arrival
      scheduleNextArrival();

      // Check bed availability
      if (cfg.numBeds !== null && busyBeds >= cfg.numBeds) {
        bedQueue.push(pid);
        recordEvent();
      } else {
        if (cfg.numBeds !== null) busyBeds++;
        const p = patientMap.get(pid)!;
        p.nurseQueueEnter = now;
        nurseQueue.push(pid);
        recordEvent();
        tryStartNurse();
      }
    } else if (event.type === 'NURSE_END') {
      const pid = event.patientId;
      busyNurses--;
      const p = patientMap.get(pid)!;
      p.nurseServiceEnd = now;

      // Enter doctor queue
      p.doctorQueueEnter = now;
      docQueue.push(pid);
      recordEvent();

      tryStartNurse();
      tryStartDoctor();
    } else if (event.type === 'DOCTOR_END') {
      const pid = event.patientId;
      busyDocs--;
      const p = patientMap.get(pid)!;
      p.doctorServiceEnd = now;
      p.departTime = now;

      // Release bed if finite
      if (cfg.numBeds !== null) {
        busyBeds--;
        tryAcquireBed();
      }

      p.totalWaitMin = (p.nurseWaitMin || 0) + (p.doctorWaitMin || 0);
      p.totalSystemTimeMin = (now - (p.arrivalTime || now)) * 60.0;
      completedPatients.push(p as PatientRecord);
      recordEvent();

      tryStartDoctor();
    }
  }

  // Final event snapshot at simHours
  now = cfg.simHours;
  recordEvent();

  // Compute time-weighted integrals for stats
  const tStart = cfg.warmupHours;
  const tEnd = cfg.simHours;
  const duration = Math.max(1e-9, tEnd - tStart);

  const computeIntegral = (accessor: (e: TimeSeriesEvent) => number) => {
    let area = 0;
    for (let i = 0; i < rawEvents.length - 1; i++) {
      const eCurrent = rawEvents[i];
      const eNext = rawEvents[i + 1];
      const t1 = Math.max(tStart, Math.min(tEnd, eCurrent.time));
      const t2 = Math.max(tStart, Math.min(tEnd, eNext.time));
      if (t2 > t1) {
        area += accessor(eCurrent) * (t2 - t1);
      }
    }
    return area / duration;
  };

  const nurseLq = computeIntegral((e) => e.qNurse);
  const nurseBusy = computeIntegral((e) => e.nNurse);
  const nurseL = nurseLq + nurseBusy;
  const nurseRho = nurseBusy / cfg.numNurses;

  const docLq = computeIntegral((e) => e.qDoc);
  const docBusy = computeIntegral((e) => e.nDoc);
  const docL = docLq + docBusy;
  const docRho = docBusy / cfg.numDoctors;

  const bedOccupancy = computeIntegral((e) => e.bedsInUse);
  const bedUtil = cfg.numBeds !== null ? bedOccupancy / cfg.numBeds : 0.0;

  // Filter completed patients who arrived after warmup
  const validPatients = completedPatients.filter((p) => p.arrivalTime >= tStart);
  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const nurseWqHours = avg(validPatients.map((p) => p.nurseWaitMin / 60.0));
  const nurseWHours = avg(validPatients.map((p) => (p.nurseServiceEnd - p.nurseQueueEnter)));
  const docWqHours = avg(validPatients.map((p) => p.doctorWaitMin / 60.0));
  const docWHours = avg(validPatients.map((p) => (p.doctorServiceEnd - p.doctorQueueEnter)));
  const totalWqHours = avg(validPatients.map((p) => p.totalWaitMin / 60.0));
  const totalWHours = avg(validPatients.map((p) => p.totalSystemTimeMin / 60.0));

  const summary: SimulationSummary = {
    doctorRho: docRho,
    doctorWq: docWqHours,
    doctorW: docWHours,
    doctorLq: docLq,
    doctorL: docL,
    nurseRho: nurseRho,
    nurseWq: nurseWqHours,
    nurseW: nurseWHours,
    nurseLq: nurseLq,
    nurseL: nurseL,
    bedUtil,
    bedOccupancy,
    totalWq: totalWqHours,
    totalW: totalWHours,
    totalLq: nurseLq + docLq,
    totalL: nurseL + docL,
  };

  return {
    patients: completedPatients,
    events: rawEvents,
    summary,
  };
}

/**
 * Runs full simulation experiment across multiple replications and aggregates statistics with 95% CI.
 */
export function runSimulationExperiment(config: SimConfig): SimulationResult {
  const t0 = performance.now();
  const reps = Math.max(1, config.replications);
  const summaries: SimulationSummary[] = [];
  let sampleRun: SingleRunResult | null = null;

  for (let r = 0; r < reps; r++) {
    const rng = new SeededRNG(config.seed + r * 1007);
    const runRes = runSingleReplication(config, rng);
    summaries.push(runRes.summary);
    if (r === 0) {
      sampleRun = runRes;
    }
  }

  const keys = Object.keys(summaries[0]) as (keyof SimulationSummary)[];
  const summaryMean = {} as SimulationSummary;
  const summaryCi95 = {} as { [key in keyof SimulationSummary]: [number, number] };

  // Calculate mean and 95% CI (t-multiplier approx 2.09 for ~20 reps, 1.96 for large)
  const tMultiplier = reps > 30 ? 1.96 : 2.093;

  for (const k of keys) {
    const values = summaries.map((s) => s[k]);
    const mean = values.reduce((a, b) => a + b, 0) / reps;
    summaryMean[k] = mean;

    if (reps > 1) {
      const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (reps - 1);
      const sem = Math.sqrt(variance / reps);
      summaryCi95[k] = [Math.max(0, mean - tMultiplier * sem), mean + tMultiplier * sem];
    } else {
      summaryCi95[k] = [mean, mean];
    }
  }

  // Resample time-series events onto 5-minute grid for chart efficiency
  const gridDt = 5.0 / 60.0; // 5 mins in hours
  const resampledEvents: TimeSeriesEvent[] = [];
  if (sampleRun && sampleRun.events.length > 0) {
    const evs = sampleRun.events;
    let evIdx = 0;
    for (let t = 0; t <= config.simHours; t += gridDt) {
      while (evIdx < evs.length - 1 && evs[evIdx + 1].time <= t) {
        evIdx++;
      }
      resampledEvents.push({
        time: t,
        qNurse: evs[evIdx].qNurse,
        nNurse: evs[evIdx].nNurse,
        qDoc: evs[evIdx].qDoc,
        nDoc: evs[evIdx].nDoc,
        bedsInUse: evs[evIdx].bedsInUse,
      });
    }
  }

  const elapsed = performance.now() - t0;

  return {
    config,
    summaryMean,
    summaryCi95,
    samplePatients: sampleRun ? sampleRun.patients.slice(0, 1500) : [],
    sampleEvents: resampledEvents,
    executionTimeMs: Math.round(elapsed),
  };
}
