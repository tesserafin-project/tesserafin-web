/**
 * GENERATED — do not edit by hand.
 * Source: tesserafin-design/themes/classic/{theme,tokens}.json
 * Regenerate: npm run generate:tokens
 */
import type { TesserafinTokens } from './types';

export const officialClassicTokens: TesserafinTokens = {
    color: {
        dark: {
            background: '#101010',
            surface: '#202020',
            surfaceVariant: '#2c2c2c',
            text: '#fff',
            textMuted: 'rgba(255, 255, 255, 0.7)',
            primary: '#00a4dc',
            onPrimary: '#fff',
            accent: '#aa5cc3',
            error: '#c62828',
            warning: '#ffa726',
            success: '#66bb6a',
            focus: 'rgba(255, 255, 255, 0.12)',
            divider: 'rgba(255, 255, 255, 0.12)'
        },
        light: {
            background: '#f2f2f2',
            surface: '#e8e8e8',
            surfaceVariant: '#dcdcdc',
            text: '#000',
            textMuted: 'rgba(0, 0, 0, 0.87)',
            primary: '#00a4dc',
            onPrimary: '#fff',
            accent: '#aa5cc3',
            error: '#c62828',
            warning: '#ed6c02',
            success: '#2e7d32',
            focus: '#bbb',
            divider: 'rgba(0, 0, 0, 0.14)'
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
        level1: '0 1px 2px rgba(0, 0, 0, 0.24)',
        level2: '0 2px 8px rgba(0, 0, 0, 0.28)',
        level3: '0 8px 24px rgba(0, 0, 0, 0.32)'
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
        sm: '0',
        md: '0',
        lg: '0'
    }
};

export default officialClassicTokens;
