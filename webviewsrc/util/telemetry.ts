import { vscode } from "./vscode";
import { TelemetryMessage } from "../../src/util/telemetry";

type EventArgs = Parameters<typeof import("../../src/util/telemetry").sendEvent>;
type ErrorArgs = Parameters<typeof import("../../src/util/telemetry").sendError>;
type ExceptionArgs = Parameters<typeof import("../../src/util/telemetry").sendException>;

export function sendEvent(...args: EventArgs): void {
    const telemetryMessage: TelemetryMessage = {
        command: 'telemetry',
        telemetryType: 'event',
        args,
    };
    vscode.postMessage(telemetryMessage);
}

export function sendError(...args: ErrorArgs): void {
    const telemetryMessage: TelemetryMessage = {
        command: 'telemetry',
        telemetryType: 'error',
        args,
    };
    vscode.postMessage(telemetryMessage);
}

export function sendException(error: Error, ...args: ExceptionArgs extends [Error, ...infer Rest] ? Rest : never): void {
    const telemetryMessage: TelemetryMessage = {
        command: 'telemetry',
        telemetryType: 'exception',
        args: [serializeError(error), ...args],
    };
    vscode.postMessage(telemetryMessage);
}

function serializeError(error: Error): Pick<Error, 'name' | 'message' | 'stack'> {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
    };
}
