declare module '*.png' {
    const value: any;
    export = value;
}

declare module '*.scss' {
    // style imports are handled by the bundler
    const value: string;
    export default value;
}

declare module '*.css' {
    // style imports are handled by the bundler
    const value: string;
    export default value;
}

// Side-effect only CSS package (no type declarations, resolved by the bundler).
declare module 'material-design-icons-iconfont';
