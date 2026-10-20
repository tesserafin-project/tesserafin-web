export const commands: string[] = [];
export default {
    handleCommand: (command: string) => {
        commands.push(command);
    }
};
