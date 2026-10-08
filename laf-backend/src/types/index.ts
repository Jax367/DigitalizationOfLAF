export interface Env { DB: D1Database; IMAGES: R2Bucket; ASSETS: Fetcher; ADMIN_BOOTSTRAP_KEY?: string; DEPLOYMENT_MODE?:string; WORKERS_PLAN?:string; CLEANUP_IMAGE_BATCH?:string; CLEANUP_ROW_BATCH?:string; ALLOWED_HOSTS?:string; ALLOWED_SOURCE_IPS?:string; ENTRY_LIMITER?:RateLimit; READ_LIMITER?:RateLimit; WRITE_LIMITER?:RateLimit; AUTH_LIMITER?:RateLimit; UPLOAD_LIMITER?:RateLimit; UPLOAD_GLOBAL_MB?:string; UPLOAD_USER_MB?:string; UPLOAD_DAILY_MB?:string; UPLOAD_GLOBAL_COUNT?:string; UPLOAD_USER_COUNT?:string; UPLOAD_DAILY_COUNT?:string; MAX_RECORDS?:string; LOG_RETENTION_DAYS?:string }
export type Role = 'admin' | 'editor';
export type ItemStatus = 'found' | 'claimed';
export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  approval_status: 'pending' | 'approved' | 'rejected' | 'disabled';
  can_edit: number;
  created_at: string;
}
export type PublicUser = Omit<User, 'password_hash'>;
export interface Item {
  id: number;
  title: string;
  description: string | null;
  floor: string | null;
  image_id: string | null;
  status: ItemStatus;
  created_at: string;
}
export interface Log {
  id: number;
  user_id: number | null;
  action: string | null;
  target: string | null;
  details: string | null;
  created_at: string;
}
