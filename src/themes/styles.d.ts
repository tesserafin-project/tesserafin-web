import '@mui/material/styles';

/** Extend MUI types to include our customizations. */
declare module '@mui/material/styles' {
    interface ColorSchemeOverrides {
        'official.classic': true;
        appletv: true;
        blueradiance: true;
        purplehaze: true;
        wmc: true;
    }

    interface Palette {
        starIcon: Palette['primary'];
    }

    interface PaletteOptions {
        starIcon?: PaletteOptions['primary'];
    }
}
