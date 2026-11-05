import { describe, expect, it } from 'vitest';
import { nativeNetworkMessage } from '../../src/lib/api';

describe('why the Fire TV app could not reach a server', () => {
  const url = 'http://line.example.ru/player_api.php?username=u&password=p';
  it.each([
    ['java.net.UnknownHostException: Unable to resolve host "line.example.ru": No address associated with hostname', "Can't find the server “line.example.ru”"],
    ['java.net.ConnectException: failed to connect to line.example.ru/1.2.3.4 (port 80): connect failed: ECONNREFUSED (Connection refused)', 'refused the connection'],
    ['java.net.SocketTimeoutException: timeout', "didn't answer in time"],
    ['javax.net.ssl.SSLHandshakeException: Trust anchor for certification path not found.', 'Secure connection'],
  ])('%s', (raw, expected) => {
    const msg = nativeNetworkMessage(raw, url);
    expect(msg).toContain(expected);
    expect(msg).not.toContain('password');
  });
});
