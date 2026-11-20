export interface HealthRepository {
  check(): Promise<void>;
  close(): Promise<void>;
}
