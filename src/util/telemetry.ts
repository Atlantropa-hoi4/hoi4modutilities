import { TelemetryReporter, type TelemetryEventMeasurements, type TelemetryEventProperties } from '@vscode/extension-telemetry';

interface TelemetryReporterInterface {
    sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
    sendTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
    sendTelemetryException(error: Error, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
    dispose(): Promise<unknown>;
}

let telemetryReporter: TelemetryReporterInterface | undefined = undefined;

export interface TelemetryMessage {
    command: 'telemetry';
    telemetryType: 'event' | 'error' | 'exception';
    args: unknown[];
}

const connectionString = 'InstrumentationKey=41a5f5b6-f4f0-4707-96ba-c895a2dabf17';

export function registerTelemetryReporter() {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
        telemetryReporter = new ProdTelemetryReporter(new TelemetryReporter(connectionString));
    } else {
        telemetryReporter = new DevTelemetryReporter();
    }

    return {
        dispose: () => {
            void telemetryReporter?.dispose();
            telemetryReporter = undefined;
        }
    };
}

export function sendEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
    telemetryReporter?.sendTelemetryEvent(eventName, properties, measurements);
}

export function sendError(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
    telemetryReporter?.sendTelemetryErrorEvent(eventName, properties, measurements);
}

export function sendException(error: Error, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
    telemetryReporter?.sendTelemetryException(error, properties, measurements);
}

export function sendByMessage(message: TelemetryMessage) {
    switch (message.telemetryType) {
        case 'event':
            sendEvent(...(message.args as Parameters<typeof sendEvent>));
            break;
        case 'error':
            sendError(...(message.args as Parameters<typeof sendError>));
            break;
        case 'exception': {
            const args = [...message.args];
            const errorLike = args[0] as { message?: string; name?: string; stack?: string };
            const error = new Error(errorLike.message);
            error.name = errorLike.name ?? 'Error';
            error.stack = errorLike.stack;
            args[0] = error;
            sendException(...(args as Parameters<typeof sendException>));
            break;
        }
    }
}

class DevTelemetryReporter implements TelemetryReporterInterface {
    sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
        console.log('TelemetryEvent', eventName, JSON.stringify(properties), JSON.stringify(measurements));
    }

    sendTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
        console.error('TelemetryErrorEvent', eventName, JSON.stringify(properties), JSON.stringify(measurements));
    }

    sendTelemetryException(error: Error, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
        console.error('TelemetryException', error, JSON.stringify(properties), JSON.stringify(measurements));
    }

    async dispose(): Promise<void> {
    }
}

class ProdTelemetryReporter implements TelemetryReporterInterface {
    constructor(private readonly reporter: TelemetryReporter) {
    }

    sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
        this.reporter.sendTelemetryEvent(eventName, properties, measurements);
    }

    sendTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
        this.reporter.sendTelemetryErrorEvent(eventName, properties, measurements);
    }

    sendTelemetryException(error: Error, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
        this.reporter.sendTelemetryErrorEvent(error.name || 'exception', {
            ...properties,
            message: error.message,
        }, measurements);
    }

    dispose(): Promise<unknown> {
        return this.reporter.dispose();
    }
}
