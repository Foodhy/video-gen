// In-memory job registry for long-running ffmpeg renders.
export type JobStatus = "running" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0..1
  outputFile?: string; // relative to project dir
  outputPath?: string; // absolute, for reveal
  clips?: unknown[]; // derived assets produced by the job (e.g. separated stems)
  error?: string;
}

const jobs = new Map<string, Job>();

export function createJob(): Job {
  const id = "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const job: Job = { id, status: "running", progress: 0 };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const j = jobs.get(id);
  if (j) Object.assign(j, patch);
}
