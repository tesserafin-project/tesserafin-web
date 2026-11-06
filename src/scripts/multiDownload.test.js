import { describe, expect, it } from 'vitest';
import { toDownloadUrl } from './multiDownload';

describe('toDownloadUrl', () => {
    it('keeps absolute http(s) and blob URLs', () => {
        expect(
            toDownloadUrl('https://media.example/Items/1/Download?api_key=x')
        ).toBe('https://media.example/Items/1/Download?api_key=x');
        expect(toDownloadUrl('http://10.0.0.2:8096/Items/1/Download')).toBe(
            'http://10.0.0.2:8096/Items/1/Download'
        );
        const blob = 'blob:' + document.location.origin + '/0b2c';
        expect(toDownloadUrl(blob)).toBe(blob);
    });

    it('resolves a relative URL against the document', () => {
        expect(toDownloadUrl('/Items/1/Download')).toBe(
            new URL('/Items/1/Download', document.baseURI).href
        );
    });

    it.each([
        'javascript:alert(1)',
        ' JavaScript:alert(1)',
        'java\tscript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd'
    ])('refuses %j', (url) => {
        expect(() => toDownloadUrl(url)).toThrow(/refusing to download/);
    });
});
