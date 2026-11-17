/**
 * Supabase client and storage utility with local fallback.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CloudScenario } from './types';

const STORAGE_KEY_SCENARIOS = 'er_simulator_scenarios';
const STORAGE_KEY_CONFIG = 'er_simulator_supabase_cfg';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getStoredSupabaseConfig(): SupabaseConfig {
  if (typeof window === 'undefined') {
    return {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    };
  }

  const stored = localStorage.getItem(STORAGE_KEY_CONFIG);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.url && parsed.anonKey) return parsed;
    } catch {}
  }

  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
}

export function saveStoredSupabaseConfig(cfg: SupabaseConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg));
  }
}

export function getSupabaseClient(): SupabaseClient | null {
  const cfg = getStoredSupabaseConfig();
  if (cfg.url && cfg.anonKey) {
    try {
      return createClient(cfg.url, cfg.anonKey);
    } catch (e) {
      console.warn('Failed to initialize Supabase client:', e);
      return null;
    }
  }
  return null;
}

/**
 * Fetch scenarios from Supabase or fallback to localStorage.
 */
export async function fetchScenarios(): Promise<{ data: CloudScenario[]; isCloud: boolean }> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from('simulation_runs')
        .select('*')
        .order('id', { ascending: false });

      if (!error && data && data.length >= 0) {
        return { data: data as CloudScenario[], isCloud: true };
      }
    } catch (e) {
      console.warn('Supabase query error, using local fallback:', e);
    }
  }

  // Local fallback
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY_SCENARIOS);
    if (raw) {
      try {
        return { data: JSON.parse(raw), isCloud: false };
      } catch {}
    }
  }

  // Default seed scenarios if empty
  const defaultSeeds: CloudScenario[] = [
    {
      id: 1,
      scenario_name: '시나리오 A: 정상 운영 (안정 상태, rho ≈ 0.78)',
      created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
      arrival_rate: 3.5,
      doctor_mu: 1.5,
      num_doctors: 3,
      nurse_mu: 1.0,
      num_nurses: 6,
      num_beds: 15,
      sim_hours: 48,
      doctor_rho: 0.778,
      doctor_wq_min: 17.5,
      doctor_w_min: 57.5,
      doctor_lq: 1.02,
      doctor_l: 3.35,
      status: 'OK',
    },
    {
      id: 2,
      scenario_name: '시나리오 B: 병목 주의 (가동률 85% 초과, rho ≈ 0.86)',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      arrival_rate: 3.5,
      doctor_mu: 1.35,
      num_doctors: 3,
      nurse_mu: 1.0,
      num_nurses: 6,
      num_beds: 15,
      sim_hours: 48,
      doctor_rho: 0.864,
      doctor_wq_min: 34.2,
      doctor_w_min: 78.6,
      doctor_lq: 2.15,
      doctor_l: 4.58,
      status: 'WARNING',
    },
    {
      id: 3,
      scenario_name: '시나리오 C: 과부하 및 시스템 불안정 (rho = 1.00)',
      created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
      arrival_rate: 4.5,
      doctor_mu: 1.5,
      num_doctors: 3,
      nurse_mu: 1.0,
      num_nurses: 6,
      num_beds: 15,
      sim_hours: 48,
      doctor_rho: 1.0,
      doctor_wq_min: 98.4,
      doctor_w_min: 138.4,
      doctor_lq: 7.38,
      doctor_l: 10.38,
      status: 'UNSTABLE',
    },
  ];

  return { data: defaultSeeds, isCloud: false };
}

/**
 * Save scenario to Supabase or fallback to localStorage.
 */
export async function saveScenario(
  scenario: Omit<CloudScenario, 'id' | 'created_at'>
): Promise<{ success: boolean; isCloud: boolean }> {
  const newRecord: CloudScenario = {
    ...scenario,
    created_at: new Date().toISOString(),
  };

  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client.from('simulation_runs').insert([newRecord]);
      if (!error) {
        return { success: true, isCloud: true };
      }
    } catch (e) {
      console.warn('Supabase insert error, falling back to local:', e);
    }
  }

  // Local storage fallback
  if (typeof window !== 'undefined') {
    const { data } = await fetchScenarios();
    const nextId = (data[0]?.id ? Number(data[0].id) : 0) + 1;
    const updated = [{ ...newRecord, id: nextId }, ...data];
    localStorage.setItem(STORAGE_KEY_SCENARIOS, JSON.stringify(updated));
    return { success: true, isCloud: false };
  }

  return { success: false, isCloud: false };
}

/**
 * Delete a scenario.
 */
export async function deleteScenario(id: string | number): Promise<boolean> {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { error } = await client.from('simulation_runs').delete().eq('id', id);
      if (!error) return true;
    } catch {}
  }

  if (typeof window !== 'undefined') {
    const { data } = await fetchScenarios();
    const filtered = data.filter((item) => String(item.id) !== String(id));
    localStorage.setItem(STORAGE_KEY_SCENARIOS, JSON.stringify(filtered));
    return true;
  }
  return false;
}
