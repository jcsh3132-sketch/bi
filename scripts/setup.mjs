import {randomBytes,scryptSync} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
if(existsSync('.env.local')){console.error('.env.local already exists. Kept existing credentials.');process.exit(1);}
mkdirSync('.local',{recursive:true});
const password=randomBytes(24).toString('base64url');
const salt=randomBytes(16).toString('base64url');
const vars={ADMIN_PASSWORD_HASH:`scrypt$${salt}$${scryptSync(password,salt,64).toString('base64url')}`,CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
writeFileSync('.env.local',Object.entries({...vars,APP_ORIGIN:'http://127.0.0.1:3000',LOCAL_DATABASE_PATH:'.local/dashboard.db'}).map(([k,v])=>`${k}=${v.replaceAll('$','\\$')}`).join('\n')+'\n',{mode:0o600});
writeFileSync('.local/deployment-secrets.json',JSON.stringify(vars,null,2),{mode:0o600});
writeFileSync('.local/owner-access.txt',`개인 대시보드 로그인 비밀번호\n${password}\n\n외부에 공유하지 마세요.\n`,{mode:0o600});
console.log('Created .env.local and .local/owner-access.txt. Secrets were not printed.');
