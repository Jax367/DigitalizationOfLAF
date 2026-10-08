import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const key = randomBytes(32).toString('hex');
try {
  await writeFile(new URL('../.dev.vars', import.meta.url), `ADMIN_BOOTSTRAP_KEY="${key}"\n`, { flag: 'wx' });
  console.log('已生成本地管理员初始化密钥（保存在 .dev.vars，不输出到控制台）。');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.dev.vars 已存在，保留原配置。');
  else throw error;
}
