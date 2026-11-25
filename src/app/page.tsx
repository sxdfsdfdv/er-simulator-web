'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  Flame,
  HelpCircle,
  Layers,
  LineChart as LineChartIcon,
  Play,
  RefreshCw,
  Sliders,
  Sparkles,
  Stethoscope,
  Trash2,
  Users,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';

import { CloudScenario, SimConfig } from '@/lib/types';
import { mmsMetrics, recommendStaff, sweepServers } from '@/lib/mathModel';
import { runSimulationExperiment } from '@/lib/simulationEngine';
import {
  deleteScenario,
  fetchScenarios,
  getStoredSupabaseConfig,
  saveScenario,
  saveStoredSupabaseConfig,
  SupabaseConfig,
  testSupabaseConnection,
  SCHEMA_SQL,
  TestResult,
} from '@/lib/supabase';

export default function Home() {
  // ---------------------------------------------------------------------------
  // 1. Simulation Parameter States
  // ---------------------------------------------------------------------------
  const [arrivalRate, setArrivalRate] = useState(3.5);
  const [doctorMu, setDoctorMu] = useState(1.5);
  const [numDoctors, setNumDoctors] = useState(3);
  const [nurseMu, setNurseMu] = useState(1.0);
  const [numNurses, setNumNurses] = useState(6);
  const [infiniteBeds, setInfiniteBeds] = useState(false);
  const [numBeds, setNumBeds] = useState(15);
  const [simHours, setSimHours] = useState(48);
  const [warmupHours, setWarmupHours] = useState(2.0);
  const [replications, setReplications] = useState(20);
  const [seed, setSeed] = useState(42);
  const [targetWqMin, setTargetWqMin] = useState(15.0);

  // UI States
  const [selectedStage, setSelectedStage] = useState<'doctor' | 'nurse'>('doctor');
  const [activeTab, setActiveTab] = useState<'compare' | 'timeseries' | 'tradeoff' | 'cloud'>('compare');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [supabaseCfg, setSupabaseCfg] = useState<SupabaseConfig>({ url: '', anonKey: '' });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [scenarios, setScenarios] = useState<CloudScenario[]>([]);
  const [isCloudStorage, setIsCloudStorage] = useState(false);
  const [scenarioLoadError, setScenarioLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [appliedMsg, setAppliedMsg] = useState('');
  const [selectedScenario, setSelectedScenario] = useState<CloudScenario | null>(null);

  // 시나리오 파라미터를 현재 시뮬레이션에 적용하는 함수
  const handleApplyScenario = (sc: CloudScenario) => {
    setArrivalRate(sc.arrival_rate);
    setDoctorMu(sc.doctor_mu);
    setNumDoctors(sc.num_doctors);
    setNurseMu(sc.nurse_mu);
    setNumNurses(sc.num_nurses);
    if (sc.num_beds === null) {
      setInfiniteBeds(true);
    } else {
      setInfiniteBeds(false);
      setNumBeds(sc.num_beds);
    }
    setSimHours(sc.sim_hours);
    setSelectedScenario(null);
    setActiveTab('compare');
    setAppliedMsg(`"${sc.scenario_name}" 파라미터가 시뮬레이션에 적용되었습니다!`);
    setTimeout(() => setAppliedMsg(''), 5000);
  };

  // Load Supabase configuration & initial scenarios
  const loadScenarios = async () => {
    setScenarioLoadError(null);
    const res = await fetchScenarios();
    setScenarios(res.data);
    setIsCloudStorage(res.isCloud);
    if ((res as any).error) setScenarioLoadError((res as any).error);
  };

  useEffect(() => {
    const cfg = getStoredSupabaseConfig();
    setSupabaseCfg(cfg);
    loadScenarios();
  }, []);

  // ---------------------------------------------------------------------------
  // 2. Real-Time Simulation & Theoretical Calculations
  // ---------------------------------------------------------------------------
  const config: SimConfig = useMemo(
    () => ({
      arrivalRate,
      doctorMu,
      numDoctors,
      nurseMu,
      numNurses,
      numBeds: infiniteBeds ? null : numBeds,
      simHours,
      warmupHours,
      replications,
      seed,
    }),
    [arrivalRate, doctorMu, numDoctors, nurseMu, numNurses, infiniteBeds, numBeds, simHours, warmupHours, replications, seed]
  );

  // Simulation execution (Runs in ~15ms)
  const simResult = useMemo(() => runSimulationExperiment(config), [config]);

  // Theoretical M/M/s calculations
  const doctorTheory = useMemo(() => mmsMetrics(arrivalRate, doctorMu, numDoctors), [arrivalRate, doctorMu, numDoctors]);
  const nurseTheory = useMemo(() => mmsMetrics(arrivalRate, nurseMu, numNurses), [arrivalRate, nurseMu, numNurses]);

  const activeTheory = selectedStage === 'doctor' ? doctorTheory : nurseTheory;
  const activeS = selectedStage === 'doctor' ? numDoctors : numNurses;
  const activeMu = selectedStage === 'doctor' ? doctorMu : nurseMu;
  const stageName = selectedStage === 'doctor' ? '진료 단계 (의사)' : '간호 단계 (간호사)';

  // Trade-off sweep calculation
  const sweepRange = useMemo(() => {
    const maxS = Math.max(10, activeS + 4);
    const range: number[] = [];
    for (let s = 1; s <= maxS; s++) range.push(s);
    return range;
  }, [activeS]);

  const sweepData = useMemo(() => {
    const results = sweepServers(arrivalRate, activeMu, sweepRange);
    return results.map((r) => ({
      s: r.s,
      rho: r.rho * 100,
      wqMin: r.Wq !== null ? r.Wq * 60 : null,
      stable: r.stable,
    }));
  }, [arrivalRate, activeMu, sweepRange]);

  const recommendedS = useMemo(
    () => recommendStaff(arrivalRate, activeMu, targetWqMin, 0.85, Math.max(15, activeS + 6)),
    [arrivalRate, activeMu, targetWqMin, activeS]
  );

  // Bottleneck resource determination
  const bottleneckInfo = useMemo(() => {
    const docRho = doctorTheory.rho;
    const nurseRho = nurseTheory.rho;
    const bedUtil = simResult.summaryMean.bedUtil;

    const items = [
      { name: '진료(의사)', util: docRho },
      { name: '간호(간호사)', util: nurseRho },
    ];
    if (config.numBeds !== null && bedUtil > 0) {
      items.push({ name: '응급실 병상', util: bedUtil });
    }
    return items.reduce((prev, curr) => (curr.util > prev.util ? curr : prev));
  }, [doctorTheory.rho, nurseTheory.rho, simResult.summaryMean.bedUtil, config.numBeds]);

  // ---------------------------------------------------------------------------
  // 3. Scenario Presets
  // ---------------------------------------------------------------------------
  const applyPreset = (preset: 'A' | 'B' | 'C' | 'D') => {
    if (preset === 'A') {
      setArrivalRate(3.5);
      setDoctorMu(1.5);
      setNumDoctors(3);
      setNumNurses(6);
      setNumBeds(15);
      setInfiniteBeds(false);
    } else if (preset === 'B') {
      setArrivalRate(3.5);
      setDoctorMu(1.35);
      setNumDoctors(3);
      setNumNurses(6);
      setNumBeds(15);
      setInfiniteBeds(false);
    } else if (preset === 'C') {
      setArrivalRate(4.5);
      setDoctorMu(1.5);
      setNumDoctors(3);
      setNumNurses(6);
      setNumBeds(15);
      setInfiniteBeds(false);
    } else if (preset === 'D') {
      setArrivalRate(4.5);
      setDoctorMu(1.5);
      setNumDoctors(4);
      setNumNurses(6);
      setNumBeds(15);
      setInfiniteBeds(false);
    }
  };

  // Save current run to Supabase
  const handleSaveScenario = async () => {
    setIsSaving(true);
    const status = activeTheory.rho >= 1.0 ? 'UNSTABLE' : activeTheory.rho >= 0.85 ? 'WARNING' : 'OK';
    const res = await saveScenario({
      scenario_name: `실행 시나리오 (λ=${arrivalRate}, 의사=${numDoctors}명)`,
      arrival_rate: arrivalRate,
      doctor_mu: doctorMu,
      num_doctors: numDoctors,
      nurse_mu: nurseMu,
      num_nurses: numNurses,
      num_beds: config.numBeds,
      sim_hours: simHours,
      doctor_rho: Number(simResult.summaryMean.doctorRho.toFixed(3)),
      doctor_wq_min: Number((simResult.summaryMean.doctorWq * 60).toFixed(1)),
      doctor_w_min: Number((simResult.summaryMean.doctorW * 60).toFixed(1)),
      doctor_lq: Number(simResult.summaryMean.doctorLq.toFixed(2)),
      doctor_l: Number(simResult.summaryMean.doctorL.toFixed(2)),
      status,
    });
    setIsSaving(false);
    setSaveSuccessMsg(res.isCloud ? '클라우드(Supabase)에 저장되었습니다!' : '로컬 스토리지에 저장되었습니다.');
    setTimeout(() => setSaveSuccessMsg(''), 4000);
    loadScenarios();
  };

  const handleDeleteScenario = async (id: string | number) => {
    await deleteScenario(id);
    loadScenarios();
  };

  // CSV Download
  const downloadPatientsCSV = () => {
    const headers = ['patient_id', 'arrival_time', 'nurse_wait_min', 'doctor_wait_min', 'total_wait_min', 'total_system_time_min'];
    const rows = simResult.samplePatients.map((p) => [
      p.patientId,
      p.arrivalTime.toFixed(3),
      p.nurseWaitMin.toFixed(2),
      p.doctorWaitMin.toFixed(2),
      p.totalWaitMin.toFixed(2),
      p.totalSystemTimeMin.toFixed(2),
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'er_patients_simulation_log.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // JSON Download
  const downloadConfigJSON = () => {
    const data = {
      config,
      summaryMean: simResult.summaryMean,
      summaryCi95: simResult.summaryCi95,
      executionTimeMs: simResult.executionTimeMs,
      timestamp: new Date().toISOString(),
    };
    const jsonStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', jsonStr);
    link.setAttribute('download', 'er_simulation_config_summary.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ---------------------------------------------------------------------------
  // KPI Metrics Data
  // ---------------------------------------------------------------------------
  const simRho = selectedStage === 'doctor' ? simResult.summaryMean.doctorRho : simResult.summaryMean.nurseRho;
  const simWq = selectedStage === 'doctor' ? simResult.summaryMean.doctorWq * 60 : simResult.summaryMean.nurseWq * 60;
  const simW = selectedStage === 'doctor' ? simResult.summaryMean.doctorW * 60 : simResult.summaryMean.nurseW * 60;
  const simLq = selectedStage === 'doctor' ? simResult.summaryMean.doctorLq : simResult.summaryMean.nurseLq;
  const simL = selectedStage === 'doctor' ? simResult.summaryMean.doctorL : simResult.summaryMean.nurseL;

  const thRho = activeTheory.rho;
  const thWq = activeTheory.Wq !== null ? activeTheory.Wq * 60 : null;
  const thW = activeTheory.W !== null ? activeTheory.W * 60 : null;
  const thLq = activeTheory.Lq;
  const thL = activeTheory.L;

  // Comparison Bar Chart Data
  const compBarData = [
    { name: '가동률(%)', 이론: Number((thRho * 100).toFixed(1)), 시뮬레이션: Number((simRho * 100).toFixed(1)) },
    { name: '대기시간(분)', 이론: thWq !== null ? Number(thWq.toFixed(1)) : 0, 시뮬레이션: Number(simWq.toFixed(1)) },
    { name: '체류시간(분)', 이론: thW !== null ? Number(thW.toFixed(1)) : 0, 시뮬레이션: Number(simW.toFixed(1)) },
    { name: '대기환자(명)', 이론: thLq !== null ? Number(thLq.toFixed(2)) : 0, 시뮬레이션: Number(simLq.toFixed(2)) },
    { name: '재원환자(명)', 이론: thL !== null ? Number(thL.toFixed(2)) : 0, 시뮬레이션: Number(simL.toFixed(2)) },
  ];

  // Wait time histogram data (bucketed)
  const histData = useMemo(() => {
    const waits = simResult.samplePatients.map((p) => (selectedStage === 'doctor' ? p.doctorWaitMin : p.nurseWaitMin));
    if (waits.length === 0) return [];
    const maxWait = Math.max(...waits, 1);
    const bins = 12;
    const step = maxWait / bins;
    const counts = new Array(bins).fill(0);

    waits.forEach((w) => {
      const idx = Math.min(bins - 1, Math.floor(w / step));
      counts[idx]++;
    });

    return counts.map((count, i) => ({
      range: `${(i * step).toFixed(0)}~${((i + 1) * step).toFixed(0)}분`,
      환자수: count,
    }));
  }, [simResult.samplePatients, selectedStage]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0B1F3A] flex flex-col font-sans">
      {/* -------------------------------------------------------------------- */}
      {/* Top Header */}
      {/* -------------------------------------------------------------------- */}
      <header className="bg-white border-b border-[#E2E8F0] sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-[#1E5AA8] text-white p-2 rounded-lg shadow-sm">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold text-[#0B1F3A]">응급실 인력 및 자원 배치 시뮬레이터</h1>
                <span className="bg-[#EEF3FA] text-[#1E5AA8] text-xs font-semibold px-2 py-0.5 rounded border border-[#CBD5E1]">
                  Cloud Edition
                </span>
              </div>
              <p className="text-xs text-[#64748B]">대기행렬 이론(M/M/s Erlang-C) & 이산 사건 시뮬레이션(DES)</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Stage Toggle */}
            <div className="bg-[#EEF3FA] p-1 rounded-lg flex items-center space-x-1 text-xs font-medium">
              <button
                onClick={() => setSelectedStage('doctor')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  selectedStage === 'doctor' ? 'bg-[#1E5AA8] text-white shadow-sm font-semibold' : 'text-[#64748B] hover:text-[#0B1F3A]'
                }`}
              >
                의사 진료 단계
              </button>
              <button
                onClick={() => setSelectedStage('nurse')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  selectedStage === 'nurse' ? 'bg-[#1E5AA8] text-white shadow-sm font-semibold' : 'text-[#64748B] hover:text-[#0B1F3A]'
                }`}
              >
                간호 처치 단계
              </button>
            </div>

            {/* Supabase status badge */}
            <button
              onClick={() => setShowConfigModal(true)}
              className={`flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-lg border transition-all ${
                isCloudStorage
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>{isCloudStorage ? 'Supabase 연동 중' : '로컬 모드 (Supabase 미연동)'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* -------------------------------------------------------------------- */}
      {/* Main Container */}
      {/* -------------------------------------------------------------------- */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-6 w-full">
        {/* Left Sidebar: Parameter Controls */}
        <aside className="w-full lg:w-80 shrink-0 space-y-5">
          <div className="bg-white rounded-xl border border-[#E2E8F0] p-5 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center space-x-2 text-sm font-bold text-[#0B1F3A]">
                <Sliders className="w-4 h-4 text-[#1E5AA8]" />
                <span>파라미터 제어 패널</span>
              </div>
              <span className="text-[11px] text-[#64748B]">실시간 반영</span>
            </div>

            {/* Quick Demo Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#64748B]">추천 시나리오 프리셋</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => applyPreset('A')}
                  className="text-xs px-2.5 py-1.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#EEF3FA] text-left text-[#0B1F3A] font-medium"
                >
                  🟢 A. 정상 (ρ=0.78)
                </button>
                <button
                  onClick={() => applyPreset('B')}
                  className="text-xs px-2.5 py-1.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#EEF3FA] text-left text-[#0B1F3A] font-medium"
                >
                  🟡 B. 병목 (ρ=0.86)
                </button>
                <button
                  onClick={() => applyPreset('C')}
                  className="text-xs px-2.5 py-1.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#EEF3FA] text-left text-[#0B1F3A] font-medium"
                >
                  🔴 C. 과부하 (ρ=1.0)
                </button>
                <button
                  onClick={() => applyPreset('D')}
                  className="text-xs px-2.5 py-1.5 rounded border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#EEF3FA] text-left text-[#0B1F3A] font-medium"
                >
                  ✨ D. 의사 증원
                </button>
              </div>
            </div>

            {/* Parameter Inputs */}
            <div className="space-y-4">
              {/* Lambda */}
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-[#0B1F3A]">환자 도착률 (λ, 명/시간)</span>
                  <span className="text-[#1E5AA8] font-bold">{arrivalRate.toFixed(1)} 명/h</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="12.0"
                  step="0.5"
                  value={arrivalRate}
                  onChange={(e) => setArrivalRate(parseFloat(e.target.value))}
                  className="w-full accent-[#1E5AA8]"
                />
                <div className="flex justify-between text-[10px] text-[#94A3B8]">
                  <span>0.5명 (한산)</span>
                  <span>일 약 {(arrivalRate * 24).toFixed(0)}명</span>
                  <span>12.0명 (폭주)</span>
                </div>
              </div>

              {/* Doctor mu & numDoctors */}
              <div className="pt-2 border-t border-[#F1F5F9] space-y-3">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-[#0B1F3A]">
                  <Users className="w-3.5 h-3.5 text-[#1E5AA8]" />
                  <span>진료 단계 (의사 자원)</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span className="text-[#64748B]">의사 1인당 처리율 (μ_d)</span>
                    <span className="text-[#0B1F3A] font-semibold">{doctorMu.toFixed(1)} 명/h</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="6.0"
                    step="0.1"
                    value={doctorMu}
                    onChange={(e) => setDoctorMu(parseFloat(e.target.value))}
                    className="w-full accent-[#1E5AA8]"
                  />
                  <span className="text-[10px] text-[#94A3B8]">평균 진료시간: {((1 / doctorMu) * 60).toFixed(0)}분</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span className="text-[#64748B]">당직 의사 수 (s_d)</span>
                    <span className="text-[#0B1F3A] font-semibold">{numDoctors} 명</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    step="1"
                    value={numDoctors}
                    onChange={(e) => setNumDoctors(parseInt(e.target.value))}
                    className="w-full accent-[#1E5AA8]"
                  />
                </div>
              </div>

              {/* Nurse mu & numNurses */}
              <div className="pt-2 border-t border-[#F1F5F9] space-y-3">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-[#0B1F3A]">
                  <Users className="w-3.5 h-3.5 text-[#00A896]" />
                  <span>간호 단계 (간호사 자원)</span>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span className="text-[#64748B]">간호사 1인당 처리율 (μ_n)</span>
                    <span className="text-[#0B1F3A] font-semibold">{nurseMu.toFixed(1)} 명/h</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="8.0"
                    step="0.1"
                    value={nurseMu}
                    onChange={(e) => setNurseMu(parseFloat(e.target.value))}
                    className="w-full accent-[#00A896]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-medium mb-1">
                    <span className="text-[#64748B]">당직 간호사 수 (s_n)</span>
                    <span className="text-[#0B1F3A] font-semibold">{numNurses} 명</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="30"
                    step="1"
                    value={numNurses}
                    onChange={(e) => setNumNurses(parseInt(e.target.value))}
                    className="w-full accent-[#00A896]"
                  />
                </div>
              </div>

              {/* Beds */}
              <div className="pt-2 border-t border-[#F1F5F9] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0B1F3A]">응급실 병상</span>
                  <label className="flex items-center space-x-1.5 text-xs cursor-pointer text-[#64748B]">
                    <input
                      type="checkbox"
                      checked={infiniteBeds}
                      onChange={(e) => setInfiniteBeds(e.target.checked)}
                      className="rounded text-[#1E5AA8]"
                    />
                    <span>병상 무제한</span>
                  </label>
                </div>
                {!infiniteBeds && (
                  <div>
                    <div className="flex justify-between text-xs font-medium mb-1">
                      <span className="text-[#64748B]">가용 병상 수</span>
                      <span className="text-[#0B1F3A] font-semibold">{numBeds} 병상</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="60"
                      step="1"
                      value={numBeds}
                      onChange={(e) => setNumBeds(parseInt(e.target.value))}
                      className="w-full accent-[#F0A202]"
                    />
                  </div>
                )}
              </div>

              {/* Simulation Run Options */}
              <div className="pt-2 border-t border-[#F1F5F9] space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64748B]">시뮬레이션 시간</span>
                  <select
                    value={simHours}
                    onChange={(e) => setSimHours(parseInt(e.target.value))}
                    className="border border-[#CBD5E1] rounded px-2 py-1 text-xs bg-white text-[#0B1F3A]"
                  >
                    <option value={24}>24시간 (1일)</option>
                    <option value={48}>48시간 (2일)</option>
                    <option value={72}>72시간 (3일)</option>
                  </select>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#64748B]">목표 대기시간</span>
                  <div className="flex items-center space-x-1">
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={targetWqMin}
                      onChange={(e) => setTargetWqMin(parseFloat(e.target.value) || 15)}
                      className="w-16 border border-[#CBD5E1] rounded px-1.5 py-0.5 text-xs text-right"
                    />
                    <span className="text-[#64748B]">분</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Action Button */}
            <button
              onClick={handleSaveScenario}
              disabled={isSaving}
              className="w-full flex items-center justify-center space-x-2 bg-[#1E5AA8] hover:bg-[#184886] text-white py-2.5 rounded-lg text-xs font-semibold shadow-sm transition-all"
            >
              <Database className="w-4 h-4" />
              <span>{isSaving ? '저장 중...' : '현재 시나리오 클라우드 DB 저장'}</span>
            </button>
            {saveSuccessMsg && (
              <p className="text-center text-xs font-medium text-emerald-600 bg-emerald-50 py-1.5 rounded border border-emerald-200">
                {saveSuccessMsg}
              </p>
            )}
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 space-y-5">
          {/* 적용 완료 알림 토스트 배너 */}
          {appliedMsg && (
            <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between text-emerald-900 shadow-md">
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold">{appliedMsg}</span>
              </div>
              <button
                onClick={() => setAppliedMsg('')}
                className="text-emerald-700 hover:text-emerald-900 text-xs px-2.5 py-1 rounded bg-emerald-100 hover:bg-emerald-200 font-medium"
              >
                확인
              </button>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* Status & Bottleneck Alert Banner */}
          {/* ------------------------------------------------------------------ */}
          <div
            className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm ${
              activeTheory.rho >= 1.0
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : activeTheory.rho >= 0.85
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center space-x-3">
              {activeTheory.rho >= 1.0 ? (
                <Flame className="w-5 h-5 text-rose-600 shrink-0" />
              ) : activeTheory.rho >= 0.85 ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <div>
                <div className="font-bold text-sm">
                  {activeTheory.rho >= 1.0
                    ? `⛔ 시스템 과부하 및 불안정 상태 (가동률 ${(activeTheory.rho * 100).toFixed(1)}%)`
                    : activeTheory.rho >= 0.85
                    ? `⚠️ 병목 주의 상태 (가동률 ${(activeTheory.rho * 100).toFixed(1)}% > 85%)`
                    : `✅ 정상 안정 운영 상태 (가동률 ${(activeTheory.rho * 100).toFixed(1)}% ≤ 85%)`}
                </div>
                <p className="text-xs opacity-90 mt-0.5">
                  {activeTheory.rho >= 1.0
                    ? `도착 환자 수가 처리 용량을 초과하여 대기열이 발산합니다. 최소 ${recommendedS || activeS + 1}명 이상으로 증원이 필요합니다.`
                    : activeTheory.rho >= 0.85
                    ? `대기시간 급증 구간입니다. 권장 최소 인력: ${recommendedS || activeS + 1}명`
                    : `환자 유입 대비 인력 배치가 안정적이며 지연 대기가 정상 범위 내입니다.`}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <span className="text-xs font-semibold px-2.5 py-1 rounded bg-white/80 border border-current">
                주요 병목: {bottleneckInfo.name} ({(bottleneckInfo.util * 100).toFixed(1)}%)
              </span>
              <span className="text-xs font-medium text-slate-500 bg-white/50 px-2 py-1 rounded">
                연산속도 {simResult.executionTimeMs}ms
              </span>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Top 5 KPI Cards */}
          {/* ------------------------------------------------------------------ */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            {/* Card 1: rho */}
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
              <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">의료진 가동률 (ρ)</span>
              <div className="text-2xl font-black text-[#0B1F3A] mt-1">{(simRho * 100).toFixed(1)}%</div>
              <div className="text-xs text-[#64748B] mt-1 flex justify-between">
                <span>이론: {(thRho * 100).toFixed(1)}%</span>
                <span className="text-emerald-600 font-medium">오차 {Math.abs(simRho - thRho).toFixed(2)}%</span>
              </div>
            </div>

            {/* Card 2: Wq */}
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
              <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">평균 대기시간 (Wq)</span>
              <div className="text-2xl font-black text-[#0B1F3A] mt-1">{simWq.toFixed(1)} 분</div>
              <div className="text-xs text-[#64748B] mt-1 flex justify-between">
                <span>이론: {thWq !== null ? `${thWq.toFixed(1)}분` : 'N/A (불안정)'}</span>
                {thWq !== null && (
                  <span className="text-indigo-600 font-medium">
                    오차 {((Math.abs(simWq - thWq) / Math.max(1e-6, thWq)) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* Card 3: W */}
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
              <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">평균 체류시간 (W)</span>
              <div className="text-2xl font-black text-[#0B1F3A] mt-1">{simW.toFixed(1)} 분</div>
              <div className="text-xs text-[#64748B] mt-1 flex justify-between">
                <span>이론: {thW !== null ? `${thW.toFixed(1)}분` : 'N/A'}</span>
                {thW !== null && (
                  <span className="text-indigo-600 font-medium">
                    오차 {((Math.abs(simW - thW) / Math.max(1e-6, thW)) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>

            {/* Card 4: Lq */}
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
              <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">대기 환자 수 (Lq)</span>
              <div className="text-2xl font-black text-[#0B1F3A] mt-1">{simLq.toFixed(2)} 명</div>
              <div className="text-xs text-[#64748B] mt-1 flex justify-between">
                <span>이론: {thLq !== null ? `${thLq.toFixed(2)}명` : 'N/A'}</span>
              </div>
            </div>

            {/* Card 5: L */}
            <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm col-span-2 md:col-span-1">
              <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">재원 환자 수 (L)</span>
              <div className="text-2xl font-black text-[#0B1F3A] mt-1">{simL.toFixed(2)} 명</div>
              <div className="text-xs text-[#64748B] mt-1 flex justify-between">
                <span>이론: {thL !== null ? `${thL.toFixed(2)}명` : 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Tabs Navigation */}
          {/* ------------------------------------------------------------------ */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="border-b border-[#E2E8F0] px-4 flex space-x-6">
              {[
                { id: 'compare', label: '📊 성능 비교 (이론 vs 시뮬레이션)' },
                { id: 'timeseries', label: '📈 시계열 분석 (시간별 추이)' },
                { id: 'tradeoff', label: '⚖️ Trade-off 분석 (인력 최적화)' },
                { id: 'cloud', label: '☁️ Supabase 클라우드 DB & 내보내기' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-3.5 text-xs font-bold border-b-2 transition-all ${
                    activeTab === tab.id ? 'border-[#1E5AA8] text-[#1E5AA8]' : 'border-transparent text-[#64748B] hover:text-[#0B1F3A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5">
              {/* TAB 1: Comparison */}
              {activeTab === 'compare' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Comparison Table */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-bold text-[#0B1F3A]">1. 핵심 지표 상세 비교표 ({stageName})</h3>
                      <div className="overflow-x-auto border border-[#E2E8F0] rounded-lg">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#EEF3FA] text-[#0B1F3A] font-semibold border-b border-[#E2E8F0]">
                            <tr>
                              <th className="py-2.5 px-3">지표</th>
                              <th className="py-2.5 px-3">이론값 (M/M/s)</th>
                              <th className="py-2.5 px-3">시뮬레이션 (DES)</th>
                              <th className="py-2.5 px-3">오차율</th>
                              <th className="py-2.5 px-3">95% 신뢰구간</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E8F0]">
                            <tr>
                              <td className="py-2 px-3 font-medium">가동률 (ρ)</td>
                              <td className="py-2 px-3">{(thRho * 100).toFixed(1)}%</td>
                              <td className="py-2 px-3 font-semibold">{(simRho * 100).toFixed(1)}%</td>
                              <td className="py-2 px-3 text-emerald-600">{Math.abs(simRho - thRho).toFixed(2)}%</td>
                              <td className="py-2 px-3 text-slate-500">
                                [{(simResult.summaryCi95.doctorRho[0] * 100).toFixed(1)}%, {(simResult.summaryCi95.doctorRho[1] * 100).toFixed(1)}%]
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 font-medium">평균 대기시간 (Wq)</td>
                              <td className="py-2 px-3">{thWq !== null ? `${thWq.toFixed(1)}분` : 'N/A'}</td>
                              <td className="py-2 px-3 font-semibold">{simWq.toFixed(1)}분</td>
                              <td className="py-2 px-3 text-indigo-600">
                                {thWq !== null ? `${((Math.abs(simWq - thWq) / thWq) * 100).toFixed(1)}%` : 'N/A'}
                              </td>
                              <td className="py-2 px-3 text-slate-500">
                                [{(simResult.summaryCi95.doctorWq[0] * 60).toFixed(1)}, {(simResult.summaryCi95.doctorWq[1] * 60).toFixed(1)}] 분
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 font-medium">평균 체류시간 (W)</td>
                              <td className="py-2 px-3">{thW !== null ? `${thW.toFixed(1)}분` : 'N/A'}</td>
                              <td className="py-2 px-3 font-semibold">{simW.toFixed(1)}분</td>
                              <td className="py-2 px-3 text-indigo-600">
                                {thW !== null ? `${((Math.abs(simW - thW) / thW) * 100).toFixed(1)}%` : 'N/A'}
                              </td>
                              <td className="py-2 px-3 text-slate-500">
                                [{(simResult.summaryCi95.doctorW[0] * 60).toFixed(1)}, {(simResult.summaryCi95.doctorW[1] * 60).toFixed(1)}] 분
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 font-medium">대기 환자 수 (Lq)</td>
                              <td className="py-2 px-3">{thLq !== null ? `${thLq.toFixed(2)}명` : 'N/A'}</td>
                              <td className="py-2 px-3 font-semibold">{simLq.toFixed(2)}명</td>
                              <td className="py-2 px-3">
                                {thLq !== null && thLq > 0 ? `${((Math.abs(simLq - thLq) / thLq) * 100).toFixed(1)}%` : '-'}
                              </td>
                              <td className="py-2 px-3 text-slate-500">
                                [{simResult.summaryCi95.doctorLq[0].toFixed(2)}, {simResult.summaryCi95.doctorLq[1].toFixed(2)}] 명
                              </td>
                            </tr>
                            <tr>
                              <td className="py-2 px-3 font-medium">재원 환자 수 (L)</td>
                              <td className="py-2 px-3">{thL !== null ? `${thL.toFixed(2)}명` : 'N/A'}</td>
                              <td className="py-2 px-3 font-semibold">{simL.toFixed(2)}명</td>
                              <td className="py-2 px-3">
                                {thL !== null && thL > 0 ? `${((Math.abs(simL - thL) / thL) * 100).toFixed(1)}%` : '-'}
                              </td>
                              <td className="py-2 px-3 text-slate-500">
                                [{simResult.summaryCi95.doctorL[0].toFixed(2)}, {simResult.summaryCi95.doctorL[1].toFixed(2)}] 명
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-[#64748B]">
                        ※ 가동률 및 L/Lq는 시간가중 적분(Time-weighted integration) 방식으로 이론값과 정합성을 엄밀히 맞춥니다.
                      </p>
                    </div>

                    {/* Compare Bar Chart */}
                    <div className="space-y-2">
                      <h3 className="text-sm font-bold text-[#0B1F3A]">2. 이론 모델 vs 시뮬레이션 주요 지표 차트</h3>
                      <div className="h-64 w-full bg-[#F8FAFC] p-3 rounded-lg border border-[#E2E8F0]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={compBarData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="이론" fill="#6FA8DC" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="시뮬레이션" fill="#1E5AA8" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Histogram */}
                  <div className="space-y-2 pt-4 border-t border-[#E2E8F0]">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">3. 환자별 대기시간 분포 (히스토그램)</h3>
                    <div className="h-56 w-full bg-[#F8FAFC] p-3 rounded-lg border border-[#E2E8F0]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={histData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="환자수" fill="#00A896" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Time-Series */}
              {activeTab === 'timeseries' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-sm font-bold text-[#0B1F3A]">시간 흐름에 따른 응급실 대기열 및 병상 점유 추이</h3>
                      <p className="text-xs text-[#64748B]">
                        가상 운영 {simHours}시간 동안의 동적 이벤트 변화를 5분 격자로 연속 추적합니다.
                      </p>
                    </div>
                    {config.numBeds !== null && (
                      <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded">
                        총 {config.numBeds}병상 중 평균 {simResult.summaryMean.bedOccupancy.toFixed(1)}병상 점유 (
                        {(simResult.summaryMean.bedUtil * 100).toFixed(1)}%)
                      </span>
                    )}
                  </div>

                  <div className="h-80 w-full bg-[#F8FAFC] p-3 rounded-lg border border-[#E2E8F0]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={simResult.sampleEvents} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} unit="h" />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area type="stepAfter" dataKey="qDoc" name="진료 대기환자수 (의사)" stroke="#1E5AA8" fill="#1E5AA8" fillOpacity={0.15} strokeWidth={2} />
                        <Area type="stepAfter" dataKey="qNurse" name="간호 대기환자수 (간호사)" stroke="#00A896" fill="#00A896" fillOpacity={0.1} strokeWidth={1.5} />
                        <Area type="monotone" dataKey="bedsInUse" name="점유 병상수" stroke="#F0A202" fill="#F0A202" fillOpacity={0.08} strokeWidth={1.5} strokeDasharray="4 4" />
                        {config.numBeds !== null && (
                          <ReferenceLine y={config.numBeds} label="병상 정원" stroke="#D64045" strokeDasharray="3 3" />
                        )}
                        <ReferenceLine x={warmupHours} label="워밍업 종료" stroke="#94A3B8" strokeDasharray="3 3" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* TAB 3: Trade-Off Curve */}
              {activeTab === 'tradeoff' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-2">
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className="text-sm font-bold text-[#0B1F3A]">인력 수(s) 배치에 따른 대기시간 vs 가동률 Trade-off</h3>
                          <p className="text-xs text-[#64748B]">인력 증원에 따른 환자 대기시간 감소 효과와 인건비 효율성 간의 상충 곡선</p>
                        </div>
                      </div>

                      <div className="h-80 w-full bg-[#F8FAFC] p-3 rounded-lg border border-[#E2E8F0]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={sweepData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="s" tick={{ fontSize: 11 }} unit="명" />
                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit="분" />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 120]} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line yAxisId="left" type="monotone" dataKey="wqMin" name="평균 대기시간 (분)" stroke="#1E5AA8" strokeWidth={3} dot={{ r: 4 }} />
                            <Line yAxisId="right" type="monotone" dataKey="rho" name="의료진 가동률 (%)" stroke="#F0A202" strokeWidth={2} strokeDasharray="4 4" />
                            <ReferenceLine yAxisId="right" y={85} stroke="#F0A202" strokeDasharray="3 3" label="안전 상한 85%" />
                            <ReferenceLine yAxisId="left" y={targetWqMin} stroke="#00A896" strokeDasharray="3 3" label={`목표 ${targetWqMin}분`} />
                            <ReferenceLine yAxisId="left" x={activeS} stroke="#1E5AA8" strokeWidth={2} label={`현재 ${activeS}명`} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Recommendation Card */}
                    <div className="bg-[#EEF3FA] p-5 rounded-xl border border-[#CBD5E1] space-y-4">
                      <div className="flex items-center space-x-2 text-[#0B1F3A] font-bold text-sm">
                        <Sparkles className="w-4 h-4 text-[#1E5AA8]" />
                        <span>AI 기반 최적 인력 추천</span>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between py-1 border-b border-[#CBD5E1]">
                          <span className="text-[#64748B]">현재 배치 인력:</span>
                          <span className="font-bold text-[#0B1F3A]">{activeS} 명</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-[#CBD5E1]">
                          <span className="text-[#64748B]">목표 대기시간:</span>
                          <span className="font-semibold text-[#0B1F3A]">{targetWqMin} 분 이하</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-[#CBD5E1]">
                          <span className="text-[#64748B]">가동률 상한선:</span>
                          <span className="font-semibold text-[#0B1F3A]">85.0% 이하</span>
                        </div>
                      </div>

                      {recommendedS !== null ? (
                        <div className="p-4 bg-white rounded-lg border border-[#CBD5E1] space-y-2">
                          <span className="text-[11px] font-bold text-[#1E5AA8] uppercase">권장 최소 인력</span>
                          <div className="text-3xl font-black text-[#0B1F3A]">{recommendedS} 명</div>
                          <p className="text-xs text-[#64748B]">
                            {recommendedS === activeS
                              ? '현재 배치가 목표 대기시간 및 가동률 기준을 완벽하게 만족합니다.'
                              : recommendedS > activeS
                              ? `현재 배치 대비 ${recommendedS - activeS}명 증원 시 목표 대기시간에 도달할 수 있습니다.`
                              : `현재 배치 대비 여유가 있어 ${activeS - recommendedS}명 감축 운영도 가능합니다.`}
                          </p>
                        </div>
                      ) : (
                        <div className="p-3 bg-rose-50 text-rose-800 rounded-lg text-xs">
                          현재 유입 환자 수준이 너무 높아 탐색 범위 내에서 적정 인력을 찾지 못했습니다.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Cloud DB & Export */}
              {activeTab === 'cloud' && (
                <div className="space-y-6">
                  {/* Export Buttons */}
                  <div className="p-4 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-[#0B1F3A]">원시 데이터 및 설정 내보내기</h4>
                      <p className="text-xs text-[#64748B]">시뮬레이션 환자별 로그 및 설정 JSON 파일을 로컬로 내려받습니다.</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={downloadPatientsCSV}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-[#CBD5E1] hover:bg-slate-50 text-[#0B1F3A] rounded-lg text-xs font-semibold shadow-sm transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>환자 로그 CSV</span>
                      </button>
                      <button
                        onClick={downloadConfigJSON}
                        className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-[#CBD5E1] hover:bg-slate-50 text-[#0B1F3A] rounded-lg text-xs font-semibold shadow-sm transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>설정 JSON</span>
                      </button>
                    </div>
                  </div>

                  {/* Scenarios Table */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Database className="w-4 h-4 text-[#1E5AA8]" />
                        <h4 className="text-sm font-bold text-[#0B1F3A]">
                          {isCloudStorage ? '☁️ Supabase 클라우드 저장 시나리오 목록' : '💾 로컬 저장 시나리오 목록'}
                        </h4>
                      </div>
                      <button
                        onClick={loadScenarios}
                        className="flex items-center space-x-1 text-xs text-[#1E5AA8] hover:underline"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>새로고침</span>
                      </button>
                    </div>

                    {/* 연결 에러 배너 */}
                    {scenarioLoadError && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-1">
                        <p className="font-bold text-amber-800">⚠️ Supabase 연결 실패 — 로컬 데이터를 표시합니다</p>
                        <p className="text-amber-700 font-mono">{scenarioLoadError}</p>
                        <button
                          onClick={() => setShowConfigModal(true)}
                          className="mt-1 px-2.5 py-1 bg-[#1E5AA8] text-white rounded text-[11px] font-semibold"
                        >
                          ☁️ Supabase 설정 열기
                        </button>
                      </div>
                    )}

                    {/* 빈 목록 안내 */}
                    {scenarios.length === 0 && !scenarioLoadError && (
                      <div className="p-4 text-center text-sm text-slate-400 border border-dashed border-[#E2E8F0] rounded-lg">
                        저장된 시나리오가 없습니다. 왼쪽 패널에서 &quot;현재 시나리오 클라우드 DB 저장&quot; 버튼을 클릭해보세요.
                      </div>
                    )}

                    {scenarios.length > 0 && (
                    <div className="overflow-x-auto border border-[#E2E8F0] rounded-lg">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-[#EEF3FA] text-[#0B1F3A] font-semibold border-b border-[#E2E8F0]">
                          <tr>
                            <th className="py-2.5 px-3">시나리오명</th>
                            <th className="py-2.5 px-3">도착률(λ)</th>
                            <th className="py-2.5 px-3">의사수</th>
                            <th className="py-2.5 px-3">가동률(ρ)</th>
                            <th className="py-2.5 px-3">대기시간(Wq)</th>
                            <th className="py-2.5 px-3">상태</th>
                            <th className="py-2.5 px-3 text-right">관리</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E8F0]">
                          {scenarios.map((sc) => (
                            <tr
                              key={sc.id}
                              className="hover:bg-blue-50/60 cursor-pointer transition-colors"
                              onClick={() => setSelectedScenario(sc)}
                            >
                              <td className="py-2.5 px-3 font-semibold text-[#0B1F3A]">
                                {sc.scenario_name}
                                <span className="block text-[9px] text-slate-400 font-normal mt-0.5">클릭하여 상세 보기 및 적용</span>
                              </td>
                              <td className="py-2.5 px-3">{sc.arrival_rate} 명/h</td>
                              <td className="py-2.5 px-3">{sc.num_doctors} 명</td>
                              <td className="py-2.5 px-3 font-medium">{(sc.doctor_rho * 100).toFixed(1)}%</td>
                              <td className="py-2.5 px-3 font-medium">{sc.doctor_wq_min} 분</td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    sc.status === 'OK'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : sc.status === 'WARNING'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {sc.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <div className="flex items-center justify-end space-x-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApplyScenario(sc);
                                    }}
                                    className="px-2.5 py-1 text-xs font-semibold bg-[#1E5AA8] hover:bg-[#154687] text-white rounded-md shadow-sm transition-colors flex items-center space-x-1 cursor-pointer"
                                    title="이 시나리오 파라미터를 시뮬레이션에 즉시 적용"
                                  >
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>적용</span>
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); sc.id && handleDeleteScenario(sc.id); }}
                                    className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors"
                                    title="삭제"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Scenario Detail Modal */}
      {/* -------------------------------------------------------------------- */}
      {selectedScenario && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-[#E2E8F0] space-y-5 max-h-[90vh] overflow-y-auto">

            {/* 헤더 */}
            <div className="flex justify-between items-start border-b border-[#E2E8F0] pb-4">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <Layers className="w-5 h-5 text-[#1E5AA8]" />
                  <h2 className="text-lg font-bold text-[#0B1F3A]">{selectedScenario.scenario_name}</h2>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedScenario.status === 'OK'
                        ? 'bg-emerald-100 text-emerald-800'
                        : selectedScenario.status === 'WARNING'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {selectedScenario.status}
                  </span>
                </div>
                {selectedScenario.created_at && (
                  <p className="text-xs text-slate-400 flex items-center space-x-1">
                    <Clock className="w-3 h-3" />
                    <span>저장일시: {new Date(selectedScenario.created_at).toLocaleString('ko-KR')}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleApplyScenario(selectedScenario)}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#1E5AA8] hover:bg-[#154687] text-white rounded-lg shadow-sm transition-colors flex items-center space-x-1 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>즉시 적용</span>
                </button>
                <button
                  onClick={() => setSelectedScenario(null)}
                  className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1 rounded hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 파라미터 카드 그리드 */}
            <div>
              <p className="text-xs font-semibold text-[#1E5AA8] uppercase tracking-wider mb-2 flex items-center space-x-1">
                <Sliders className="w-3.5 h-3.5" />
                <span>시뮬레이션 파라미터</span>
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '도착률 (λ)', value: `${selectedScenario.arrival_rate} 명/h`, icon: <Activity className="w-4 h-4 text-[#1E5AA8]" /> },
                  { label: '의사 수', value: `${selectedScenario.num_doctors} 명`, icon: <Stethoscope className="w-4 h-4 text-[#1E5AA8]" /> },
                  { label: '간호사 수', value: `${selectedScenario.num_nurses} 명`, icon: <Users className="w-4 h-4 text-[#1E5AA8]" /> },
                  { label: '병상 수', value: selectedScenario.num_beds === null ? '∞ (무한)' : `${selectedScenario.num_beds} 개`, icon: <Layers className="w-4 h-4 text-[#1E5AA8]" /> },
                  { label: '시뮬레이션 시간', value: `${selectedScenario.sim_hours} 시간`, icon: <Clock className="w-4 h-4 text-[#1E5AA8]" /> },
                  { label: '의사 처리율 (μ)', value: `${selectedScenario.doctor_mu} 명/h`, icon: <Sparkles className="w-4 h-4 text-[#1E5AA8]" /> },
                ].map((item) => (
                  <div key={item.label} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 space-y-1">
                    <div className="flex items-center space-x-1 text-slate-500">
                      {item.icon}
                      <span className="text-[10px] font-medium">{item.label}</span>
                    </div>
                    <p className="text-sm font-bold text-[#0B1F3A]">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* KPI 결과 그리드 */}
            <div>
              <p className="text-xs font-semibold text-[#1E5AA8] uppercase tracking-wider mb-2 flex items-center space-x-1">
                <LineChartIcon className="w-3.5 h-3.5" />
                <span>KPI 결과 (의사 단계)</span>
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: '가동률 (ρ)', value: `${(selectedScenario.doctor_rho * 100).toFixed(1)}%` },
                  { label: '대기시간 Wq', value: `${selectedScenario.doctor_wq_min} 분` },
                  { label: '체류시간 W', value: `${selectedScenario.doctor_w_min} 분` },
                  { label: '대기환자 Lq', value: `${selectedScenario.doctor_lq.toFixed(2)} 명` },
                  { label: '재원환자 L', value: `${selectedScenario.doctor_l.toFixed(2)} 명` },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white border border-[#E2E8F0] rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 mb-1">{kpi.label}</p>
                    <p className="text-xl font-bold text-[#0B1F3A]">{kpi.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="flex justify-end space-x-2 pt-2 border-t border-[#E2E8F0]">
              <button
                onClick={() => setSelectedScenario(null)}
                className="px-4 py-2 text-sm border border-[#E2E8F0] rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
              >
                닫기
              </button>
              <button
                onClick={() => handleApplyScenario(selectedScenario)}
                className="px-4 py-2 text-sm bg-[#1E5AA8] hover:bg-[#154687] text-white rounded-lg transition-colors flex items-center space-x-1.5 font-semibold cursor-pointer shadow-sm"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>이 파라미터로 시뮬레이션 적용</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Supabase Config Modal */}
      {/* -------------------------------------------------------------------- */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-[#E2E8F0] space-y-4">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center space-x-2 font-bold text-[#0B1F3A]">
                <Database className="w-5 h-5 text-[#1E5AA8]" />
                <span>Supabase 클라우드 데이터베이스 설정</span>
              </div>
              <button
                onClick={() => {
                  setShowConfigModal(false);
                  setTestResult(null);
                }}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[#64748B]">
              Supabase 프로젝트의 <b>Project URL</b>과 <b>Anon API Key</b>를 입력하시면 클라우드 PostgreSQL에 시뮬레이션 데이터가 실시간 동기화됩니다.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#0B1F3A] block mb-1">Project URL</label>
                <input
                  type="text"
                  placeholder="https://xyzcompany.supabase.co"
                  value={supabaseCfg.url}
                  onChange={(e) => {
                    setSupabaseCfg({ ...supabaseCfg, url: e.target.value.trim() });
                    setTestResult(null);
                  }}
                  className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-[#1E5AA8] outline-none font-mono"
                />
                <p className="text-[11px] text-[#94A3B8] mt-1">
                  💡 Supabase ⚙️ Project Settings &gt; Data API 에서 <b>Project URL</b> 복사
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-[#0B1F3A] block mb-1">Anon / Publishable API Key</label>
                <input
                  type="password"
                  placeholder="sb_publishable_... 또는 eyJhbGciOi..."
                  value={supabaseCfg.anonKey}
                  onChange={(e) => {
                    setSupabaseCfg({ ...supabaseCfg, anonKey: e.target.value.trim() });
                    setTestResult(null);
                  }}
                  className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-[#1E5AA8] outline-none font-mono"
                />
                <p className="text-[11px] text-[#94A3B8] mt-1">
                  💡 Project API Keys 항목의 <b>anon / public</b> 키
                </p>
              </div>
            </div>

            {/* Test Connection Feedback */}
            {testResult && (
              <div className="pt-1">
                {testResult.ok ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-start space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold">{testResult.message}</p>
                      <p className="text-[11px] text-emerald-600 mt-0.5">클라우드 동기화 모드로 전환되었습니다. 창을 닫습니다...</p>
                    </div>
                  </div>
                ) : testResult.tableMissing ? (
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-2.5">
                    <div className="flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-bold">Supabase 접속 성공! 하지만 테이블이 아직 없습니다.</p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Supabase 대시보드 좌측 <b>SQL Editor</b> 메뉴에서 아래 SQL을 실행해주세요.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between bg-white border border-amber-200 rounded-lg p-2">
                      <span className="text-[11px] font-mono text-slate-600 truncate mr-2">CREATE TABLE simulation_runs ...</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(SCHEMA_SQL);
                          setCopiedSql(true);
                          setTimeout(() => setCopiedSql(false), 2000);
                        }}
                        className="shrink-0 flex items-center space-x-1 px-2.5 py-1 bg-amber-600 text-white rounded text-[11px] font-semibold hover:bg-amber-700 transition"
                      >
                        {copiedSql ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedSql ? '복사 완료!' : 'SQL 복사'}</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-amber-600">
                      👉 복사 후 Supabase SQL Editor에 붙여넣고 <b>[Run]</b>을 누른 뒤, 다시 <b>[연결 테스트 및 저장]</b>을 클릭하세요!
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold">연결 실패</p>
                      <p className="text-[11px] text-red-600 mt-0.5">{testResult.message}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(SCHEMA_SQL);
                  setCopiedSql(true);
                  setTimeout(() => setCopiedSql(false), 2000);
                }}
                className="flex items-center space-x-1 text-xs text-[#64748B] hover:text-[#0B1F3A]"
              >
                {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedSql ? 'SQL 복사됨' : '테이블 생성 SQL 보기'}</span>
              </button>

              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfigModal(false);
                    setTestResult(null);
                  }}
                  className="px-3 py-2 bg-slate-100 text-[#64748B] rounded-lg text-xs font-semibold hover:bg-slate-200"
                >
                  닫기
                </button>
                <button
                  type="button"
                  disabled={isTesting}
                  onClick={async () => {
                    setIsTesting(true);
                    setTestResult(null);
                    try {
                      const res = await testSupabaseConnection(supabaseCfg.url, supabaseCfg.anonKey);
                      setTestResult(res);
                      if (res.ok) {
                        saveStoredSupabaseConfig(supabaseCfg);
                        await loadScenarios();
                        setTimeout(() => {
                          setShowConfigModal(false);
                          setTestResult(null);
                        }, 1200);
                      }
                    } catch (e: any) {
                      setTestResult({ ok: false, message: e?.message || '연결 중 오류가 발생했습니다.' });
                    } finally {
                      setIsTesting(false);
                    }
                  }}
                  className="px-4 py-2 bg-[#1E5AA8] text-white rounded-lg text-xs font-bold hover:bg-[#184886] flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isTesting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isTesting ? '연결 확인 중...' : '연결 테스트 및 저장'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-[#E2E8F0] py-4 text-center text-xs text-[#64748B]">
        ER Queueing & Resource Allocation Simulator • Powered by Next.js, Vercel & Supabase
      </footer>
    </div>
  );
}
