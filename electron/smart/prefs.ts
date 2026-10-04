import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { RULE_PILES, type MailRule, type RulePile } from '../../src/shared/inbox';
import { JsonFile } from './store';

// What you've told the AI to keep in mind: sorting rules for the Inbox, and
// things to remember about you ("I'm a junior", "call me Jake"). The AI sees
// them in every chat, and the Inbox follows the rules.

export interface Memory {
  id: string;
  text: string;
  at: string;
}

const RULE_LIMIT = 100;
const MEMORY_LIMIT = 60;

export class Prefs {
  private readonly rulesFile: JsonFile<MailRule[]>;
  private readonly memoryFile: JsonFile<Memory[]>;

  constructor(dataDir: string) {
    this.rulesFile = new JsonFile(path.join(dataDir, 'mail-rules.json'), () => []);
    this.memoryFile = new JsonFile(path.join(dataDir, 'memory.json'), () => []);
  }

  rules(): MailRule[] {
    const list = this.rulesFile.read();
    return Array.isArray(list) ? list.filter((r) => r && typeof r.match === 'string' && RULE_PILES.includes(r.pile)) : [];
  }

  /** Adds a rule, replacing one for the same sender or words. */
  addRule(match: string, pile: RulePile): MailRule {
    const text = match.trim().slice(0, 120);
    if (!text) throw new Error('Say which sender or words the rule is for.');
    const rule: MailRule = { id: randomUUID(), match: text, pile };
    const rest = this.rules().filter((r) => r.match.toLowerCase() !== text.toLowerCase());
    this.rulesFile.write([...rest, rule].slice(-RULE_LIMIT));
    return rule;
  }

  removeRule(id: string): void {
    this.rulesFile.write(this.rules().filter((r) => r.id !== id));
  }

  memories(): Memory[] {
    const list = this.memoryFile.read();
    return Array.isArray(list) ? list.filter((m) => m && typeof m.text === 'string') : [];
  }

  remember(text: string): Memory {
    const clean = text.trim().slice(0, 300);
    if (!clean) throw new Error('Nothing to remember.');
    const memory: Memory = { id: randomUUID(), text: clean, at: new Date().toISOString() };
    this.memoryFile.write([...this.memories().filter((m) => m.text.toLowerCase() !== clean.toLowerCase()), memory].slice(-MEMORY_LIMIT));
    return memory;
  }

  forget(id: string): void {
    this.memoryFile.write(this.memories().filter((m) => m.id !== id));
  }
}
