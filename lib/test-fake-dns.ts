/**
 * A scripted stand-in for node:dns/promises, used only by lookup.test.ts to
 * drive the failure modes real DNS produces at random: timeouts, SERVFAIL,
 * refusals, and answers that never come.
 */

type Answer = () => Promise<string[]>;

export const script: Record<"resolvePtr" | "resolve4" | "resolve6", Record<string, Answer>> = {
  resolvePtr: {},
  resolve4: {},
  resolve6: {},
};

/** Every query started, with the time it started and the servers it went to. */
export const calls: { method: string; name: string; at: number; servers: string[] }[] = [];

const error = (code: string) => Object.assign(new Error(code), { code });

export const ok = (...values: string[]): Answer => () => Promise.resolve(values);
export const fail = (code: string): Answer => () => Promise.reject(error(code));
export const hang: Answer = () => new Promise<string[]>(() => {});
/** Settles like `answer`, but only after `ms` milliseconds. */
export const after = (ms: number, answer: Answer): Answer => () =>
  new Promise<string[]>((resolve, reject) => setTimeout(() => answer().then(resolve, reject), ms));

export function reset() {
  for (const table of Object.values(script)) {
    for (const key of Object.keys(table)) delete table[key];
  }
  calls.length = 0;
}

export class Resolver {
  private servers: string[] = [];

  setServers(servers: string[]) {
    for (const server of servers) {
      if (!/^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]+\]?)(:\d+)?$/i.test(server)) {
        throw Object.assign(new TypeError(`Invalid IP address: ${server}`), { code: "ERR_INVALID_IP_ADDRESS" });
      }
    }
    this.servers = servers;
  }

  private run(method: keyof typeof script, name: string) {
    calls.push({ method, name, at: Date.now(), servers: this.servers });
    const answer = script[method][name];

    return answer ? answer() : Promise.reject(error("ENOTFOUND"));
  }

  resolvePtr(name: string) {
    return this.run("resolvePtr", name);
  }

  resolve4(name: string) {
    return this.run("resolve4", name);
  }

  resolve6(name: string) {
    return this.run("resolve6", name);
  }

  reverse(): never {
    // gethostbyaddr folds timeouts and SERVFAIL into ENOTFOUND; it must not come back.
    throw new Error("dns.reverse() must not be used — query the PTR record with resolvePtr()");
  }
}
