import type { DivergenceClass } from '../api/types';

const getDivergenceClassColor = (divergenceClass: DivergenceClass) => {
    switch (divergenceClass) {
        case 'Equivalent':
        case 'ExpectedImprovement':
            return 'success';
        case 'KnownV2Limitation':
            return 'warning';
        case 'PotentialRegression':
            return 'error';
        case 'Unexplained':
            return 'default';
    }
};

export default getDivergenceClassColor;
