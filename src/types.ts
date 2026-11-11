export type EvidenceKind = 'detected' | 'estimated' | 'measured' | 'user_reported' | 'derived' | 'unknown';
export type ProbeStatus = 'passed' | 'failed' | 'indeterminate' | 'not_tested' | 'unsupported';
export type ComponentStatus = 'ok' | 'partial' | 'failed' | 'skipped';

export interface Evidence {
  kind: EvidenceKind;
  source: string;
  method?: string;
  notes?: string;
}
export interface Execution {
  device_path: 'cpu_only' | 'gpu_offload' | 'mixed' | 'unknown';
  backend_id: string | null;
  runtime_id: string | null;
  runtime_version: string | null;
  gpu_layers: number | null;
  context_tokens: number | null;
  threads: number | null;
}
export interface Diagnostic {
  kind: 'neurometr.diagnostic';
  schema_version: '0.1.0';
  run_id: string;
  started_at: string;
  finished_at: string;
  overall_status: 'ok' | 'partial' | 'failed';
  producer: { name: string; version: string; platform: string; build_id?: string };
  engines: { name: string; version: string | null; status: ComponentStatus; sha256: string | null }[];
  catalog_ref: { version: string; origin: 'bundled' | 'cached' | 'downloaded'; compatibility: ProbeStatus; sha256: string | null };
  hardware: {
    os: { family: string; version: string | null; arch: string; evidence: Evidence };
    cpu: { model: string | null; physical_cores: number | null; logical_processors: number | null; evidence: Evidence };
    ram: { physical_total_bytes: number | null; available_bytes: number | null; available_observed_at: string | null; evidence: Evidence };
    gpus: {
      index: number; name: string | null;
      memory: { dedicated_total_bytes: number | null; dedicated_available_bytes: number | null; shared_total_bytes: number | null };
      memory_topology: 'dedicated' | 'shared' | 'unified' | 'mixed' | 'unknown';
      evidence: Evidence;
    }[];
    npus: { name: string | null; detection_status: 'detected' | 'not_detected' | 'unknown'; evidence: Evidence }[];
  };
  runtime_checks: { runtime_id: string; discovery_status: 'detected' | 'not_detected' | 'unknown'; launch_status: ProbeStatus; backend_id: string | null; error_code: string | null; evidence: Evidence }[];
  model_assessments: {
    model_id: string | null; artifact_id: string | null; source_model_name: string;
    execution: Execution; fit: { status: 'fits' | 'limited' | 'does_not_fit' | 'unknown' | 'not_evaluated'; evidence: Evidence };
    speed_estimate: null | {
      tokens_per_second: number; algorithm_id: string; backend_id: string | null; execution: Execution; evidence: Evidence;
    };
    measurements: {
      kind: 'generation_tps' | 'prompt_tps' | 'ttft_ms' | 'total_latency_ms' | 'peak_working_set_bytes';
      value: number; unit: 'tokens/s' | 'ms' | 'bytes'; repetitions: number; benchmark_id: string;
      execution: Execution; evidence: Evidence; warmth?: string; latency_scope?: string;
    }[];
    load_status: ProbeStatus;
  }[];
  cloud_checks: {
    service_id: string; target_id: string; origin: 'local_agent'; checked_at: string; consent: true;
    network_context: { proxy_mode: 'direct' | 'system' | 'custom' | 'unknown' };
    probes: { stage: 'dns' | 'tcp' | 'tls' | 'http' | 'api'; status: ProbeStatus; duration_ms: number | null; http_status: number | null; error_code: string | null; evidence: Evidence }[];
    conclusion: 'reachable' | 'auth_required' | 'access_denied_unknown_reason' | 'rate_limited' | 'connection_failed' | 'unknown' | 'not_tested';
  }[];
  components: { component: string; status: ComponentStatus }[];
  errors: { component: string; code: string; message: string; retryable: boolean }[];
  limitations: string[];
}
