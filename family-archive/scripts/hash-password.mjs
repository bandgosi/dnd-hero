// Создание хэша пароля для APP_PASSWORD_HASH (сам пароль нигде не хранится).
//   npm run hash-password            — спросит пароль
//   echo "пароль" | npm run hash-password -- --stdin
import readline from 'node:readline';
import { hashPassword } from '../server/auth.js';

async function readHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('Нет терминала: используйте --stdin');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) rl.output.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s.replace(/\r?\n$/, '');
}

const fromStdin = process.argv.includes('--stdin');
let password;
if (fromStdin) password = await readStdin();
else {
  password = await readHidden('Новый пароль: ');
  const again = await readHidden('Повторите пароль: ');
  if (again !== password) {
    console.error('Пароли не совпадают.');
    process.exit(1);
  }
}
if (password.length < 10) {
  console.error('Пароль должен быть не короче 10 символов.');
  process.exit(1);
}
const hash = await hashPassword(password);
if (fromStdin) process.stdout.write(hash + '\n');
else console.log(`\nДобавьте в файл настроек:\nAPP_PASSWORD_HASH=${hash}\n`);
