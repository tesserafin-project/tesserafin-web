/**
 * Flag-only developer panel for the OneAmp demonstrator (contract §9.1,
 * §9.3 step 4): bypass, in-chain volume, preamp, EQ (enable + 10 bands) and
 * the §4.8 state readout. Not a product UI: English only, no persistence.
 */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { ObservableState, OneAmpHost } from './oneampHost';

const BANDS_HZ = [31, 63, 125, 250, 500, '1k', '2k', '4k', '8k', '16k'];

const panelStyle: React.CSSProperties = {
    position: 'fixed',
    right: 12,
    bottom: 96,
    zIndex: 100000,
    width: 300,
    maxHeight: '70vh',
    overflow: 'auto',
    padding: 12,
    borderRadius: 8,
    background: 'rgba(16, 16, 20, 0.92)',
    color: '#eee',
    font: '12px/1.4 system-ui, sans-serif',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)'
};

function Slider({
    label,
    min,
    max,
    step,
    value,
    onChange,
    testId
}: {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
    testId: string;
}) {
    return (
        <label style={{ display: 'block', margin: '4px 0' }}>
            {label} <output>{value.toFixed(2)}</output>
            <input
                type='range'
                min={min}
                max={max}
                step={step}
                value={value}
                data-testid={testId}
                onChange={(e) => onChange(Number(e.target.value))}
                style={{ width: '100%' }}
            />
        </label>
    );
}

export function OneAmpDevPanel({ host }: { host: OneAmpHost }) {
    const [s, setS] = useState<ObservableState>(host.state);
    const [bypass, setBypassState] = useState(false);
    const [open, setOpen] = useState(true);

    useEffect(() => host.subscribe(setS), [host]);

    const p = s.params;
    return (
        <section
            aria-label='OneAmp developer panel'
            data-testid='oneamp-dev-panel'
            style={panelStyle}
        >
            <header
                style={{ display: 'flex', justifyContent: 'space-between' }}
            >
                <strong>OneAmp (experimental)</strong>
                <button type='button' onClick={() => setOpen(!open)}>
                    {open ? 'Hide' : 'Show'}
                </button>
            </header>
            <p data-testid='oneamp-state'>
                {s.state}
                {s.reason ? ` (${s.reason})` : ''} · route {s.route}
            </p>
            {open && (
                <>
                    <label style={{ display: 'block' }}>
                        <input
                            type='checkbox'
                            data-testid='oneamp-bypass'
                            checked={bypass}
                            onChange={(e) => {
                                setBypassState(e.target.checked);
                                host.setBypass(e.target.checked);
                            }}
                        />{' '}
                        Bypass
                    </label>
                    <Slider
                        label='Volume'
                        min={0}
                        max={1.5}
                        step={0.01}
                        value={p.volume}
                        testId='oneamp-volume'
                        onChange={(volume) => host.setParams({ volume })}
                    />
                    <Slider
                        label='Preamp dB'
                        min={-12}
                        max={12}
                        step={0.5}
                        value={p.preamp}
                        testId='oneamp-preamp'
                        onChange={(preamp) => host.setParams({ preamp })}
                    />
                    <label style={{ display: 'block' }}>
                        <input
                            type='checkbox'
                            data-testid='oneamp-eq'
                            checked={p.eqEnabled}
                            onChange={(e) =>
                                host.setParams({ eqEnabled: e.target.checked })
                            }
                        />{' '}
                        EQ
                    </label>
                    {p.eqBands.map((db, band) => (
                        <Slider
                            key={BANDS_HZ[band]}
                            label={`${BANDS_HZ[band]} Hz`}
                            min={-12}
                            max={12}
                            step={0.5}
                            value={db}
                            testId={`oneamp-band-${band}`}
                            onChange={(v) => {
                                const eqBands = p.eqBands.slice();
                                eqBands[band] = v;
                                host.setParams({ eqBands });
                            }}
                        />
                    ))}
                    <pre
                        data-testid='oneamp-readout'
                        style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}
                    >
                        {JSON.stringify(
                            {
                                state: s.state,
                                reason: s.reason,
                                route: s.route,
                                playMethod: s.playMethod,
                                sampleRate: s.sampleRate,
                                latencyFrames: s.latencyFrames,
                                processorBypassed: s.processorBypassed,
                                normalisationOwner: s.normalisationOwner
                            },
                            null,
                            1
                        )}
                    </pre>
                    <button type='button' onClick={() => host.query()}>
                        Query processor
                    </button>
                </>
            )}
        </section>
    );
}

export function mountOneAmpDevPanel(host: OneAmpHost): () => void {
    const container = document.createElement('div');
    container.className = 'oneampDevPanel';
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<OneAmpDevPanel host={host} />);
    return () => {
        root.unmount();
        container.remove();
    };
}
