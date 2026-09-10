import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createLearningEvidenceReader } from '@/infrastructure/sqlite/learning-evidence';
let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.run('CREATE TABLE workspaces (id TEXT, settings TEXT)');
  db.run('CREATE TABLE sessions (id TEXT, workspace_id TEXT, parent_id TEXT, metadata TEXT)');
  db.run('CREATE TABLE messages (id TEXT, session_id TEXT, agent TEXT, status TEXT, role TEXT, completed_at INTEGER, created_at INTEGER, sequence INTEGER)');
  db.run('CREATE TABLE parts (message_id TEXT, type TEXT, data TEXT, created_at INTEGER)');
  db.run('CREATE TABLE learning_session_origins (session_id TEXT PRIMARY KEY, run_id TEXT NOT NULL)');
  db.run("INSERT INTO workspaces VALUES ('w', '{}')");
  db.run("INSERT INTO sessions VALUES ('s', 'w', NULL, '{}')");
  db.run("INSERT INTO messages VALUES ('u','s',NULL,NULL,'user',NULL,100,0), ('a','s','dev','completed','assistant',200,150,1), ('later','s',NULL,NULL,'user',NULL,300,2)");
  db.run(`INSERT INTO parts VALUES ('u','text','{"text":"Question"}',100), ('a','text','{"text":"Answer"}',200), ('later','text','{"text":"Not yet reviewed"}',300)`);
});
afterEach(() => db.close());
function reader() { return createLearningEvidenceReader(db, { kind: 'workspace', workspaceId: 'w' }); }

test('reads bounded completed turns and rechecks exclusions', () => {
  expect(reader().readTurn('a').map(row => row.content)).toEqual(['Question', 'Answer']);
  db.run(`UPDATE sessions SET metadata = '{"learning":{"excluded":true}}'`);
  expect(() => reader().readTurn('a')).toThrow('eligible');
  expect(reader().discover(0, 0).evidence).toEqual([]);
});
test('personal scope requires message participation and source workspace permission', () => {
  const own = createLearningEvidenceReader(db, { kind: 'agent', agentId: 'dev', sources: { mode: 'all' } });
  expect(own.eligible('a')).toBe(true);
  expect(createLearningEvidenceReader(db, { kind: 'agent', agentId: 'tester', sources: { mode: 'all' } }).eligible('a')).toBe(false);
  db.run(`UPDATE workspaces SET settings = '{"allowPersonalLearning":false}'`);
  expect(own.eligible('a')).toBe(false);
  expect(reader().eligible('a')).toBe(true);
});
test('learning ancestors, cycles, missing parents and automated sessions fail closed', () => {
  for (const metadata of ['{"learningRunId":"run"}', '{"scheduledJobId":"job"}', 'null', '{bad']) {
    db.run('UPDATE sessions SET metadata = ?', [metadata]);
    expect(reader().eligible('a')).toBe(false);
  }
  db.run("UPDATE sessions SET metadata = '{}', parent_id = 's'");
  expect(reader().eligible('a')).toBe(false);
  db.run("UPDATE sessions SET parent_id = 'missing'");
  expect(reader().eligible('a')).toBe(false);
});
test('durable origins survive metadata clearing and tool evidence obeys source settings', () => {
  db.run(`INSERT INTO parts VALUES ('a','tool','{"name":"test","state":{"status":"completed","output":"verified result"}}',201)`);
  expect(reader().readTurn('a')[1]?.content).not.toContain('verified result');
  db.run(`UPDATE workspaces SET settings = '{"sessionSearch":{"includeToolResults":true}}'`);
  expect(reader().readTurn('a')[1]).toMatchObject({ status: 'completed' });
  expect(reader().readTurn('a')[1]?.content).toContain('verified result');
  db.run("INSERT INTO learning_session_origins VALUES ('s', 'run')");
  db.run('UPDATE sessions SET metadata = NULL');
  expect(reader().eligible('a')).toBe(false);
});

test('discovery observes completed additions to existing sessions', () => {
  const first = reader().discover(0, 0);
  expect(first.evidence.map(row => row.messageId)).toEqual(['a']);
  db.run("INSERT INTO messages VALUES ('new','s','dev','completed','assistant',400,350,3)");
  expect(reader().discover(first.scannedThrough, 0).evidence.map(row => row.messageId)).toEqual(['new']);
});
