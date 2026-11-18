/**
 * One-off: moves patient documents from the old public folder (uploads/patient-files)
 * to private storage (private/patient-files). Safe to run more than once.
 *
 *   node dist/cli/move-patient-files.js          # dry run, prints what would move
 *   node dist/cli/move-patient-files.js --apply  # moves the files
 *
 * The API serves files from either place in the meantime, so the order of
 * deploy / migration / this script doesn't matter.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  copyFileSync,
  unlinkSync,
} from 'fs';
import { dirname, join } from 'path';

const SRC = join(process.cwd(), 'uploads', 'patient-files');
const DEST = join(process.cwd(), 'private', 'patient-files');
const apply = process.argv.includes('--apply');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function move(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    // Different volumes (uploads and private are separate Docker volumes): copy then delete.
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

const files = walk(SRC);
let moved = 0;
for (const from of files) {
  const to = join(DEST, from.slice(SRC.length + 1));
  if (existsSync(to)) continue;
  console.log(`${apply ? 'move' : 'would move'}: ${from} -> ${to}`);
  if (apply) move(from, to);
  moved++;
}
console.log(
  `${files.length} file(s) found, ${moved} ${apply ? 'moved' : 'to move'}.`,
);
if (!apply && moved) console.log('Run again with --apply to move them.');
