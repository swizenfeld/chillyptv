import { describe, expect, it } from 'vitest';
import { XmltvParser, parseXmltv, parseXmltvDate } from '../../shared/xmltv';

const XML = `<?xml version="1.0"?>
<tv>
  <channel id="one.tv"><display-name>One &amp; Only</display-name><icon src="http://i/1.png"/></channel>
  <programme start="20240101120000 +0100" stop="20240101130000 +0100" channel="one.tv">
    <title lang="en">News &lt;Live&gt;</title><desc><![CDATA[Daily <b>news</b>]]></desc><category>News</category>
    <episode-num system="onscreen">S1E2</episode-num>
  </programme>
  <programme start="20240101110000 +0100" stop="20240101120000 +0100" channel="one.tv"><title>Earlier</title></programme>
  <programme start="20240101120000" stop="20240101123000" channel="other"><title>Other</title></programme>
</tv>`;

describe('parseXmltvDate', () => {
  it('handles offsets', () => {
    expect(parseXmltvDate('20240101120000 +0100')).toBe(Date.UTC(2024, 0, 1, 11));
    expect(parseXmltvDate('20240101120000 -0230')).toBe(Date.UTC(2024, 0, 1, 14, 30));
    expect(parseXmltvDate('20240101120000')).toBe(Date.UTC(2024, 0, 1, 12));
    expect(Number.isNaN(parseXmltvDate('garbage'))).toBe(true);
  });
});

describe('XmltvParser', () => {
  it('parses channels and programmes, sorted, with entities and CDATA', () => {
    const d = parseXmltv(XML);
    expect(d.channels['one.tv']).toEqual({ id: 'one.tv', name: 'One & Only', icon: 'http://i/1.png' });
    const list = d.programmes['one.tv'];
    expect(list.map((p) => p[2])).toEqual(['Earlier', 'News <Live>']);
    expect(list[1][3]).toBe('Daily <b>news</b>');
    expect(list[1][5]).toBe('News');
    expect(list[1][6]).toBe('S1E2');
  });
  it('works when fed in arbitrary chunks', () => {
    const p = new XmltvParser();
    for (let i = 0; i < XML.length; i += 7) p.push(XML.slice(i, i + 7));
    const d = p.finish();
    expect(d.programmes['one.tv']).toHaveLength(2);
    expect(d.programmes['other']).toHaveLength(1);
  });
  it('filters by time window and channel', () => {
    const d = parseXmltv(XML, { from: Date.UTC(2024, 0, 1, 10, 30), channelFilter: new Set(['one.tv']) });
    expect(d.programmes['one.tv'].map((p) => p[2])).toEqual(['Earlier', 'News <Live>']);
    expect(d.programmes['other']).toBeUndefined();
    const d2 = parseXmltv(XML, { from: Date.UTC(2024, 0, 1, 11, 1) });
    expect(d2.programmes['one.tv'].map((p) => p[2])).toEqual(['News <Live>']);
  });
  it('applies a time shift', () => {
    const d = parseXmltv(XML, { shiftHours: 2 });
    expect(d.programmes['other'][0][0]).toBe(Date.UTC(2024, 0, 1, 14));
  });
});
