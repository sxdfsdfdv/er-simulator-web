/**
 * Types and interfaces for ER Queueing & Resource Allocation Simulator.
 */

export interface SimConfig {
  arrivalRate: number;      // λ, patients / hour
  doctorMu: number;         // μ_d, patients / hour / doctor
  numDoctors: number;       // s_d
  nurseMu: number;          // μ_n, patients / hour / nurse
  numNurses: number;        // s_n
  numBeds: number | null;   // null = infinite beds
  simHours: number;         // Total duration (e.g. 24, 48, 72)
  warmupHours: number;      // Initial duration to discard
  replications: number;     // Number of independent simulation runs
  seed: number;             // Random seed
}

export interface MMSResult {
  s: number;
  rho: number;              // λ / (s * μ)
  stable: boolean;          // true if rho < 1.0
  Pw: number | null;        // Erlang-C wait probability
  Wq: number | null;        // Mean wait time in queue (hours)
  W: number | null;         // Mean total time in system (hours)
  Lq: number | null;        // Mean queue length
  L: number | null;         // Mean system occupancy
}

export interface SimulationSummary {
  doctorRho: number;
  doctorWq: number;         // hours
  doctorW: number;          // hours
  doctorLq: number;
  doctorL: number;
  nurseRho: number;
  nurseWq: number;          // hours
  nurseW: number;           // hours
  nurseLq: number;
  nurseL: number;
  bedUtil: number;
  bedOccupancy: number;
  totalWq: number;          // hours
  totalW: number;           // hours
  totalLq: number;
  totalL: number;
}

export interface PatientRecord {
  patientId: number;
  arrivalTime: number;
  bedAcquiredTime: number;
  nurseQueueEnter: number;
  nurseServiceStart: number;
  nurseServiceEnd: number;
  doctorQueueEnter: number;
  doctorServiceStart: number;
  doctorServiceEnd: number;
  departTime: number;
  nurseWaitMin: number;
  doctorWaitMin: number;
  totalWaitMin: number;
  totalSystemTimeMin: number;
}

export interface TimeSeriesEvent {
  time: number;             // hours
  qNurse: number;
  nNurse: number;
  qDoc: number;
  nDoc: number;
  bedsInUse: number;
}

export interface SimulationResult {
  config: SimConfig;
  summaryMean: SimulationSummary;
  summaryCi95: { [key in keyof SimulationSummary]: [number, number] };
  samplePatients: PatientRecord[];
  sampleEvents: TimeSeriesEvent[];
  executionTimeMs: number;
}

export interface CloudScenario {
  id?: string | number;
  scenario_name: string;
  created_at?: string;
  arrival_rate: number;
  doctor_mu: number;
  num_doctors: number;
  nurse_mu: number;
  num_nurses: number;
  num_beds: number | null;
  sim_hours: number;
  doctor_rho: number;
  doctor_wq_min: number;
  doctor_w_min: number;
  doctor_lq: number;
  doctor_l: number;
  status: 'OK' | 'WARNING' | 'UNSTABLE';
}
