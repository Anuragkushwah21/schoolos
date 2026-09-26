/**
 * How this app connects to PostgreSQL.
 *
 * Deliberately free of `server-only` and of the env module, so the one-off
 * scripts in `scripts/` can import it too and connect exactly as the app does.
 */
import { Resolver, lookup as systemLookup, type LookupOptions } from "node:dns";
import net from "node:net";

export type ConnectionConfig = {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
  stream?: () => net.Socket;
};

/**
 * Public resolvers to fall back to, in order.
 *
 * Only consulted when the machine's own resolver has already failed, so a
 * working setup never talks to them.
 */
const FALLBACK_DNS = ["1.1.1.1", "8.8.8.8"];

let fallbackResolver: Resolver | undefined;

function resolver(): Resolver {
  if (!fallbackResolver) {
    fallbackResolver = new Resolver();
    fallbackResolver.setServers(FALLBACK_DNS);
  }
  return fallbackResolver;
}

/** Say the fallback kicked in, but only the first time per host. */
const announced = new Set<string>();

/**
 * `dns.lookup`, with a second opinion when the machine's resolver fails.
 *
 * `dns.lookup` is `getaddrinfo`: it asks the operating system, which asks
 * whichever nameserver the network handed out. When that nameserver is flaky
 * — a home router doing DNS over IPv6 is a common case — it intermittently
 * answers ENOTFOUND for a name that plainly exists. The database is reachable,
 * every packet would arrive, and the app reports "Can't reach database
 * server": a failure that looks like an outage and is really a bad answer to a
 * question.
 *
 * So on failure we ask a public resolver directly over UDP, through c-ares,
 * which does not go through `getaddrinfo` at all. The hostname itself is never
 * replaced — pg still hands it to TLS for SNI and certificate verification, so
 * nothing about the security of the connection changes.
 *
 * If both fail, the *original* error is reported: it is the one that describes
 * the machine the app is actually running on.
 */
const resilientLookup: net.LookupFunction = (hostname, options, callback) => {
  const opts = options as LookupOptions;

  systemLookup(hostname, opts, (error, address, family) => {
    if (!error) {
      // Node calls back with an array when it asked for every address.
      (callback as (...args: unknown[]) => void)(null, address, family);
      return;
    }

    resolver().resolve4(hostname, (fallbackError, addresses) => {
      if (fallbackError || !addresses?.length) {
        (callback as (...args: unknown[]) => void)(error);
        return;
      }

      if (!announced.has(hostname)) {
        announced.add(hostname);
        console.warn(
          `[db] this machine's DNS could not resolve ${hostname} (${error.code ?? "failed"}); ` +
            `using ${FALLBACK_DNS[0]} instead`,
        );
      }

      if (opts.all) {
        (callback as (...args: unknown[]) => void)(
          null,
          addresses.map((addr) => ({ address: addr, family: 4 })),
        );
      } else {
        (callback as (...args: unknown[]) => void)(null, addresses[0], 4);
      }
    });
  });
};

/**
 * The socket pg connects through.
 *
 * pg opens a plain socket and upgrades it to TLS itself, setting `servername`
 * from the host it was given — so swapping in a different way of resolving
 * that host leaves SNI and certificate checking exactly as they were.
 */
function resilientStream(): net.Socket {
  const socket = new net.Socket();
  const connect = socket.connect.bind(socket);

  socket.connect = ((...args: unknown[]) => {
    const [port, host] = args;
    // pg calls `connect(port, host)`; anything else (a unix socket path) is
    // passed through untouched.
    if (typeof port === "number" && typeof host === "string") {
      return connect({ port, host, lookup: resilientLookup });
    }
    return (connect as (...passed: unknown[]) => net.Socket)(...args);
  }) as typeof socket.connect;

  return socket;
}

/**
 * Say what we want of TLS in code rather than in the URL.
 *
 * node-postgres warns on every start that `sslmode=require` currently means
 * full verification and will not in a future major. We *do* want verification,
 * so the parameter is taken out of the string and the intent stated here
 * instead: the warning goes away and the meaning cannot drift under us. The
 * URL keeps `sslmode` for the sake of `psql`, which reads the same string.
 *
 * `channel_binding` is a libpq option that node-postgres does not understand;
 * it is dropped for the same reason.
 */
export function connectionConfig(databaseUrl: string): ConnectionConfig {
  const url = new URL(databaseUrl);
  const sslmode = url.searchParams.get("sslmode");

  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");

  const wantsTls = sslmode !== null && sslmode !== "disable";

  return {
    connectionString: url.toString(),
    // Verify the certificate against Node's trust store — what the hosted
    // providers serve, and what `sslmode=require` already meant here.
    ...(wantsTls ? { ssl: { rejectUnauthorized: true } } : {}),
    stream: resilientStream,
  };
}
