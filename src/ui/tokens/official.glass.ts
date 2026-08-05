/**
 * GENERATED — do not edit by hand.
 * Source: tesserafin-design/themes/glass/{theme,tokens}.json
 * Regenerate: npm run generate:tokens
 */
import type { TesserafinTokens } from './types';

export const officialGlassTokens: TesserafinTokens = {
    color: {
        dark: {
            background: '#0b0e14',
            surface: 'rgba(22, 27, 38, 0.55)',
            surfaceVariant: 'rgba(30, 37, 52, 0.6)',
            text: '#eaf0ff',
            textMuted: 'rgba(234, 240, 255, 0.65)',
            primary: '#4fd1ff',
            onPrimary: '#03121a',
            accent: '#8a7dff',
            error: '#ff6b6b',
            warning: '#ffb454',
            success: '#5ee6a8',
            focus: 'rgba(79, 209, 255, 0.45)',
            divider: 'rgba(234, 240, 255, 0.12)'
        },
        light: {
            background: '#eef2f8',
            surface: 'rgba(255, 255, 255, 0.55)',
            surfaceVariant: 'rgba(214, 224, 240, 0.6)',
            text: '#0b1220',
            textMuted: 'rgba(11, 18, 32, 0.68)',
            primary: '#0a6689',
            onPrimary: '#fff',
            accent: '#4b3fd0',
            error: '#b3261e',
            warning: '#8a5a00',
            success: '#0d6e45',
            focus: '#0a6689',
            divider: 'rgba(11, 18, 32, 0.14)'
        }
    },
    typography: {
        fontFamily: {
            base: '"Noto Sans", sans-serif',
            mono: 'ui-monospace, monospace'
        },
        fontSize: {
            xs: '0.75rem',
            sm: '0.875rem',
            md: '1rem',
            lg: '1.17rem',
            xl: '1.5rem',
            xxl: '1.8rem'
        },
        fontWeight: {
            regular: 400,
            medium: 500,
            bold: 700
        }
    },
    shape: {
        radius: {
            sm: '0.15em',
            md: '0.2em',
            lg: '0.4em',
            full: '999px'
        }
    },
    spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px'
    },
    elevation: {
        level0: 'none',
        level1: '0 1px 3px rgba(0, 0, 0, 0.4)',
        level2: '0 4px 16px rgba(0, 0, 0, 0.45)',
        level3: '0 12px 40px rgba(0, 0, 0, 0.5)'
    },
    motion: {
        duration: {
            fast: '150ms',
            normal: '300ms',
            slow: '375ms'
        },
        easing: {
            standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
            decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
            accelerate: 'cubic-bezier(0.4, 0, 1, 1)'
        }
    },
    density: 'comfortable',
    blur: {
        sm: '8px',
        md: '16px',
        lg: '28px'
    }
};

export default officialGlassTokens;
