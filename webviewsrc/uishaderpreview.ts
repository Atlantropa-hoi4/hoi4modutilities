import { getState, setState, tryRun } from "./util/common";
import {
    chooseInitialUiShaderSprite,
    getUiShaderCanvasSize,
    getUiShaderProgressDirection,
    isProgressPreview,
} from "../src/previewdef/uishader/visual";
import type { UiShaderPreviewModel, UiShaderTextureBinding } from "../src/previewdef/uishader/types";

interface ShaderPreviewGlobals {
    uiShaderPreviewModels?: Record<string, UiShaderPreviewModel>;
}

interface RenderInputs {
    time: number;
    progress: number;
    offset: [number, number];
    color: [number, number, number, number];
    effect: string;
    layerMode: number;
    progressDirection: number;
}

interface TextureHandle {
    texture: WebGLTexture | null;
    loaded: boolean;
}

interface UiShaderRenderer {
    render(options: RenderInputs): void;
}

interface PanelControls {
    element: HTMLElement;
    effectSelect: HTMLSelectElement;
    playButton: HTMLButtonElement;
    resetButton: HTMLButtonElement;
    progressInput: HTMLInputElement;
    progressValue: HTMLElement;
    speedInput: HTMLInputElement;
    layerSelect: HTMLSelectElement;
}

const selectedSpriteStateKey = 'selectedUiShaderSprite';

const vertexSource = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision mediump float;
uniform sampler2D uTexture;
uniform sampler2D uSecondaryTexture;
uniform sampler2D uMaskTexture;
uniform sampler2D uAnimatedTexture;
uniform float uTime;
uniform float uAnimationTime;
uniform vec2 uOffset;
uniform vec4 uColor;
uniform float uProgress;
uniform int uPattern;
uniform int uEffect;
uniform int uLayerMode;
uniform int uProgressDirection;
uniform int uHasSecondaryTexture;
uniform int uHasMaskTexture;
uniform int uHasAnimatedTexture;
in vec2 vUv;
out vec4 outColor;

vec4 applyButtonEffect(vec4 color, float elapsed) {
    if (uEffect == 1) {
        color.rgb *= 0.65;
    } else if (uEffect == 2) {
        color.rgb += vec3(0.18) * (0.5 + 0.5 * sin(elapsed * 4.0));
    } else if (uEffect == 3) {
        color.a *= 0.45;
    }
    return color;
}

vec4 applySpriteAnimation(vec4 color, float elapsed) {
    if (uHasAnimatedTexture == 0) {
        return color;
    }
    vec2 animUv = fract(vUv + vec2(uOffset.x * 0.25, elapsed * 0.22 + uOffset.y));
    vec4 anim = texture(uAnimatedTexture, animUv);
    float maskAlpha = uHasMaskTexture == 1 ? texture(uMaskTexture, vUv).a : anim.a;
    float blend = clamp(anim.a * maskAlpha, 0.0, 1.0);
    color.rgb = mix(color.rgb, color.rgb + anim.rgb, blend * 0.75);
    color.a = max(color.a, blend * anim.a);
    return color;
}

float radialAngle(vec2 uv) {
    return atan(uv.x - 0.5, 0.5 - uv.y) + 3.14159265;
}

float progressMask(vec2 uv, float progress) {
    float p = clamp(progress, 0.0, 1.0);
    if (uProgressDirection == 1) {
        return 1.0 - step(p, 1.0 - uv.x);
    }
    if (uProgressDirection == 2) {
        return 1.0 - step(p, uv.y);
    }
    if (uProgressDirection == 3) {
        return 1.0 - step(p, 1.0 - uv.y);
    }
    if (uProgressDirection == 4 || uProgressDirection == 5) {
        float cutoff = p * 6.2831853;
        return 1.0 - step(cutoff, radialAngle(uv));
    }
    return 1.0 - step(p, uv.x);
}

vec4 compositeProgress(vec4 primary, vec4 secondary) {
    float mask = progressMask(vUv, uProgress);
    return mix(secondary, primary, mask);
}

void main() {
    vec4 primary = texture(uTexture, vUv) * uColor;
    vec4 secondary = uHasSecondaryTexture == 1 ? texture(uSecondaryTexture, vUv) : vec4(0.0);
    vec4 color = primary;
    float elapsed = max(0.0, uTime - uAnimationTime);

    if (uPattern == 1) {
        float value = (uOffset.x * 10.0) + 1.0;
        float currentPos = floor(value / 10000.0);
        float totalPos = floor(value / 10.0) - (currentPos * 1000.0);
        float pos = value - (currentPos * 10000.0) - (totalPos * 10.0);
        float phase = (cos(elapsed * 0.5) - 1.0) / -2.0;
        float timePos = floor(totalPos * phase);
        if (pos >= 1.0 && timePos <= currentPos && elapsed < 6.5) {
            float visibleTint = smoothstep(0.15, 0.35, primary.r + primary.g + primary.b);
            color.a *= visibleTint;
        }
    } else if (uPattern == 2 || uPattern == 3) {
        color = compositeProgress(primary, secondary);
    } else if (uPattern == 4) {
        color = compositeProgress(primary, secondary);
        float angle = radialAngle(vUv);
        float notchCenter = fract(uOffset.x + elapsed * 0.08) * 6.2831853;
        float dist = abs(mod(angle - notchCenter + 9.4247779, 6.2831853) - 3.14159265);
        float notch = smoothstep(0.28, 0.02, dist);
        color.rgb += vec3(0.35) * notch;
        color.a = max(color.a, notch * primary.a);
    } else if (uPattern == 5) {
        color = applySpriteAnimation(primary, elapsed);
    }

    if (uLayerMode == 1) {
        color = primary;
    } else if (uLayerMode == 2) {
        color = secondary;
    }

    color = applyButtonEffect(color, elapsed);
    outColor = color;
}`;

window.addEventListener('load', tryRun(() => {
    const models = (window as Window & ShaderPreviewGlobals).uiShaderPreviewModels ?? {};
    const mount = document.getElementById('uiShaderVisualPanelMount');
    if (!mount) {
        return;
    }
    initializePanel(mount, models);
}));

function initializePanel(mount: HTMLElement, models: Record<string, UiShaderPreviewModel>): void {
    mount.replaceChildren();
    const names = Object.keys(models);
    if (names.length === 0) {
        mount.appendChild(createText('No UI shader preview models are available for this .gfx file. Add spriteType/progressbartype entries with effectFile to enable visual shader preview.'));
        return;
    }

    const state = getState();
    const restored = typeof state[selectedSpriteStateKey] === 'string' ? state[selectedSpriteStateKey] : undefined;
    let selectedName = restored && models[restored] ? restored : chooseInitialUiShaderSprite(models);

    const title = document.createElement('div');
    title.className = 'ui-shader-panel-title';
    title.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;';
    const titleText = document.createElement('div');
    titleText.style.cssText = 'font-weight:600;';
    const badges = document.createElement('div');
    badges.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    title.append(titleText, badges);

    const notice = createText('');
    const controlsMount = document.createElement('div');
    const stage = document.createElement('div');
    stage.className = 'ui-shader-visual-stage';
    stage.style.cssText = [
        'min-width:320px',
        'min-height:220px',
        'max-width:760px',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'margin:10px auto 0',
        'padding:12px',
        'border:1px solid var(--vscode-panel-border)',
        'background-color:var(--vscode-editorWidget-background, var(--vscode-editor-background))',
    ].join(';');

    const canvas = document.createElement('canvas');
    canvas.className = 'ui-shader-visual-canvas';
    canvas.style.cssText = [
        'display:block',
        'max-width:100%',
        'max-height:420px',
        'background-color:#222',
        'background-image:linear-gradient(45deg, rgba(255,255,255,.14) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.14) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.14) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.14) 75%)',
        'background-size:16px 16px',
        'background-position:0 0, 0 8px, 8px -8px, -8px 0',
        'border:1px solid var(--vscode-panel-border)',
    ].join(';');
    const fallback = document.createElement('div');
    fallback.style.cssText = 'display:none;max-width:720px;text-align:center;';
    stage.append(canvas, fallback);

    const detailsMount = document.createElement('div');
    mount.append(title, notice, controlsMount, stage, detailsMount);

    let controls: PanelControls | undefined;
    let renderer: UiShaderRenderer | undefined;
    let currentModel: UiShaderPreviewModel | undefined;
    let playing = true;
    let start = performance.now();
    let pausedAt = 0;

    const select = (spriteName: string | undefined) => {
        if (!spriteName || !models[spriteName]) {
            return;
        }
        selectedName = spriteName;
        setState({ [selectedSpriteStateKey]: spriteName });
        currentModel = models[spriteName];
        renderer = undefined;
        start = performance.now();
        pausedAt = 0;
        playing = currentModel.status === 'renderable';

        titleText.textContent = currentModel.source.spriteName;
        badges.replaceChildren(
            createBadge(currentModel.status, 'status'),
            createBadge(currentModel.templateId, 'template'),
            ...(currentModel.warnings.length > 0 ? [createBadge(`${currentModel.warnings.length} warning`, 'warning')] : []),
        );
        notice.textContent = `Approximate development preview, not exact in-game rendering. ${currentModel.supportReason}`;
        controls = createControls(currentModel);
        controls.playButton.textContent = playing ? 'Pause' : 'Play';
        controlsMount.replaceChildren(controls.element);
        detailsMount.replaceChildren(createMetadata(currentModel));
        updateTriggerSelection(spriteName);

        const baseTexture = findTexture(currentModel, currentModel.visual?.primaryTextureRole ?? 'base')
            ?? currentModel.bindings.find(binding => binding.uri && binding.samplerIndex === 0);
        const secondaryTexture = findTexture(currentModel, currentModel.visual?.secondaryTextureRole ?? 'secondary');
        const canvasSize = getUiShaderCanvasSize(currentModel, baseTexture);
        canvas.width = canvasSize.width;
        canvas.height = canvasSize.height;
        canvas.style.display = currentModel.status === 'renderable' && !!baseTexture?.uri ? 'block' : 'none';
        fallback.style.display = canvas.style.display === 'none' ? 'block' : 'none';
        fallback.replaceChildren(createFallbackVisual(currentModel, baseTexture));

        if (currentModel.status === 'renderable' && baseTexture?.uri) {
            renderer = createRenderer(canvas, currentModel, baseTexture.uri, secondaryTexture?.uri);
            if (!renderer) {
                canvas.style.display = 'none';
                fallback.style.display = 'block';
                fallback.replaceChildren(createText('WebGL2 is unavailable in this webview. Showing texture fallback and shader details.'));
            }
        }

        bindControlEvents(controls, () => {
            playing = !playing;
            controls!.playButton.textContent = playing ? 'Pause' : 'Play';
            if (playing) {
                start = performance.now() - pausedAt * 1000;
            }
        }, () => {
            start = performance.now();
            pausedAt = 0;
        }, () => {
            playing = false;
            controls!.playButton.textContent = 'Play';
            pausedAt = Number(controls!.progressInput.value) * 2;
            updateProgressLabel(controls!, currentModel!, Number(controls!.progressInput.value));
        });
    };

    bindPreviewTriggers(models, select);
    select(selectedName);

    const frame = () => {
        if (renderer && currentModel && controls) {
            const speed = Number(controls.speedInput.value);
            const time = playing ? (performance.now() - start) / 1000 : pausedAt;
            if (playing) {
                pausedAt = time;
            }
            const progress = playing && isProgressPreview(currentModel)
                ? triangleWave(time * speed)
                : Number(controls.progressInput.value);
            controls.progressInput.value = String(progress);
            updateProgressLabel(controls, currentModel, progress);
            renderer.render({
                time,
                progress,
                offset: vectorConstant(currentModel, 'Offset', [0, 0]) as [number, number],
                color: vectorConstant(currentModel, 'Color', [1, 1, 1, 1]) as [number, number, number, number],
                effect: controls.effectSelect.value,
                layerMode: Number(controls.layerSelect.value),
                progressDirection: progressDirectionId(getUiShaderProgressDirection(currentModel)),
            });
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

function bindPreviewTriggers(models: Record<string, UiShaderPreviewModel>, select: (spriteName: string | undefined) => void): void {
    for (const trigger of Array.from(document.querySelectorAll<HTMLButtonElement>('.uiShaderPreviewTrigger'))) {
        if (trigger.dataset.uiShaderTriggerBound === 'true') {
            continue;
        }
        trigger.dataset.uiShaderTriggerBound = 'true';
        trigger.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            select(trigger.dataset.spriteName);
        });
        trigger.disabled = !trigger.dataset.spriteName || !models[trigger.dataset.spriteName];
    }
}

function updateTriggerSelection(spriteName: string): void {
    for (const trigger of Array.from(document.querySelectorAll<HTMLButtonElement>('.uiShaderPreviewTrigger'))) {
        const active = trigger.dataset.spriteName === spriteName;
        trigger.dataset.selected = active ? 'true' : 'false';
        trigger.style.outline = active ? '1px solid var(--vscode-focusBorder)' : '';
    }
}

function createRenderer(canvas: HTMLCanvasElement, model: UiShaderPreviewModel, textureUri: string, secondaryUri: string | undefined): UiShaderRenderer | undefined {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false });
    if (!gl) {
        return undefined;
    }
    const program = createProgram(gl, vertexSource, fragmentSource);
    if (!program) {
        return undefined;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const baseTexture = createTexture(gl, textureUri);
    const secondaryTexture = createTexture(gl, secondaryUri);
    const maskTexture = createTexture(gl, findTexture(model, 'animation-mask')?.uri ?? findTexture(model, 'masking')?.uri);
    const animatedTexture = createTexture(gl, findTexture(model, 'animation-texture')?.uri);

    const uniforms = {
        texture: gl.getUniformLocation(program, 'uTexture'),
        secondaryTexture: gl.getUniformLocation(program, 'uSecondaryTexture'),
        maskTexture: gl.getUniformLocation(program, 'uMaskTexture'),
        animatedTexture: gl.getUniformLocation(program, 'uAnimatedTexture'),
        time: gl.getUniformLocation(program, 'uTime'),
        animationTime: gl.getUniformLocation(program, 'uAnimationTime'),
        offset: gl.getUniformLocation(program, 'uOffset'),
        color: gl.getUniformLocation(program, 'uColor'),
        progress: gl.getUniformLocation(program, 'uProgress'),
        pattern: gl.getUniformLocation(program, 'uPattern'),
        effect: gl.getUniformLocation(program, 'uEffect'),
        layerMode: gl.getUniformLocation(program, 'uLayerMode'),
        progressDirection: gl.getUniformLocation(program, 'uProgressDirection'),
        hasSecondaryTexture: gl.getUniformLocation(program, 'uHasSecondaryTexture'),
        hasMaskTexture: gl.getUniformLocation(program, 'uHasMaskTexture'),
        hasAnimatedTexture: gl.getUniformLocation(program, 'uHasAnimatedTexture'),
    };

    return {
        render(options) {
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            bindTexture(gl, baseTexture, 0);
            bindTexture(gl, secondaryTexture, 1);
            bindTexture(gl, maskTexture, 2);
            bindTexture(gl, animatedTexture, 3);
            gl.uniform1i(uniforms.texture, 0);
            gl.uniform1i(uniforms.secondaryTexture, 1);
            gl.uniform1i(uniforms.maskTexture, 2);
            gl.uniform1i(uniforms.animatedTexture, 3);
            gl.uniform1f(uniforms.time, options.time);
            gl.uniform1f(uniforms.animationTime, numberConstant(model, 'AnimationTime', 0));
            gl.uniform2f(uniforms.offset, options.offset[0], options.offset[1]);
            gl.uniform4f(uniforms.color, options.color[0], options.color[1], options.color[2], options.color[3]);
            gl.uniform1f(uniforms.progress, options.progress);
            gl.uniform1i(uniforms.pattern, templateId(model.templateId));
            gl.uniform1i(uniforms.effect, effectId(options.effect));
            gl.uniform1i(uniforms.layerMode, options.layerMode);
            gl.uniform1i(uniforms.progressDirection, options.progressDirection);
            gl.uniform1i(uniforms.hasSecondaryTexture, secondaryTexture.loaded ? 1 : 0);
            gl.uniform1i(uniforms.hasMaskTexture, maskTexture.loaded ? 1 : 0);
            gl.uniform1i(uniforms.hasAnimatedTexture, animatedTexture.loaded ? 1 : 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        },
    };
}

function createControls(model: UiShaderPreviewModel): PanelControls {
    const element = document.createElement('div');
    element.className = 'ui-shader-controls';
    element.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center;margin-top:8px;flex-wrap:wrap;';

    const effectSelect = document.createElement('select');
    effectSelect.title = 'Effect';
    for (const effect of model.controls.effects.length > 0 ? model.controls.effects : ['Preview']) {
        const option = document.createElement('option');
        option.value = effect;
        option.textContent = effect;
        effectSelect.appendChild(option);
    }
    effectSelect.value = model.controls.defaultEffect ?? effectSelect.value;

    const playButton = createButton('Pause', 'Play or pause animation');
    const resetButton = createButton('Reset', 'Reset time and progress');
    const progress = createRange('Progress', 0, 1, 0.001, numberConstant(model, 'CurrentState', numberConstant(model, 'vProgress', 0.5)));
    const speed = createRange('Speed', 0, 3, 0.1, 1);
    const layerSelect = document.createElement('select');
    layerSelect.title = 'Texture layer';
    for (const [value, text] of [['0', 'Composite'], ['1', 'TextureOne'], ['2', 'TextureTwo']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        layerSelect.appendChild(option);
    }
    if (!findTexture(model, model.visual?.secondaryTextureRole ?? 'secondary')) {
        layerSelect.querySelector<HTMLOptionElement>('option[value="2"]')!.disabled = true;
    }

    element.append(effectSelect, playButton, resetButton, progress.label, speed.label, layerSelect);
    updateProgressLabel({ progressValue: progress.value }, model, Number(progress.input.value));
    return {
        element,
        effectSelect,
        playButton,
        resetButton,
        progressInput: progress.input,
        progressValue: progress.value,
        speedInput: speed.input,
        layerSelect,
    };
}

function bindControlEvents(
    controls: PanelControls,
    onPlay: () => void,
    onReset: () => void,
    onScrub: () => void,
): void {
    controls.playButton.addEventListener('click', onPlay);
    controls.resetButton.addEventListener('click', onReset);
    controls.progressInput.addEventListener('input', onScrub);
}

function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | undefined {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertex);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
    if (!vertexShader || !fragmentShader) {
        return undefined;
    }
    const program = gl.createProgram();
    if (!program) {
        return undefined;
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : undefined;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | undefined {
    const shader = gl.createShader(type);
    if (!shader) {
        return undefined;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : undefined;
}

function createTexture(gl: WebGL2RenderingContext, uri: string | undefined): TextureHandle {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    const result = { texture, loaded: false };
    if (!uri) {
        return result;
    }
    const image = new Image();
    image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        result.loaded = true;
    };
    image.src = uri;
    return result;
}

function bindTexture(gl: WebGL2RenderingContext, texture: TextureHandle, unit: number): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
}

function createMetadata(model: UiShaderPreviewModel): HTMLElement {
    const details = document.createElement('details');
    details.style.cssText = 'max-width:760px;margin:8px auto 0;text-align:left;font-size:11px;';
    const summary = document.createElement('summary');
    summary.textContent = 'Shader details';
    details.appendChild(summary);
    const lines = [
        `Schema: ${model.schemaVersion}`,
        `Status: ${model.status}`,
        `Template: ${model.templateId}`,
        `Visual: ${model.visual?.previewKind ?? 'metadata'} / ${model.visual?.progressDirection ?? 'left-to-right'}`,
        `Shader: ${model.source.shaderPath ?? '(missing)'}`,
        `Includes: ${model.shader?.includes.join(', ') || '(none)'}`,
        `Feature flags: ${model.shader?.featureFlags.join(', ') || '(none)'}`,
        `Samplers: ${model.shader?.samplers.map(s => `${s.name}:${s.index}`).join(', ') || '(none)'}`,
        `Effects: ${model.shader?.effects.map(e => e.name).join(', ') || '(none)'}`,
        `Textures: ${model.bindings.map(b => `${b.samplerName}=${b.path ?? '(missing)'}`).join(', ') || '(none)'}`,
        `Dependencies: ${model.dependencies.join(', ') || '(none)'}`,
    ];
    const pre = document.createElement('pre');
    pre.textContent = lines.concat(model.warnings.map(w => `${w.severity.toUpperCase()} ${w.code}: ${w.message}`)).join('\n');
    pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 0;';
    details.appendChild(pre);
    return details;
}

function createFallbackVisual(model: UiShaderPreviewModel, baseTexture: UiShaderTextureBinding | undefined): HTMLElement {
    const wrapper = document.createElement('div');
    if (baseTexture?.uri) {
        const image = document.createElement('img');
        image.src = baseTexture.uri;
        image.alt = model.source.spriteName;
        image.style.cssText = 'max-width:100%;max-height:360px;object-fit:contain;border:1px solid var(--vscode-panel-border);';
        wrapper.appendChild(image);
    }
    wrapper.appendChild(createText(model.status === 'renderable'
        ? 'Texture fallback is shown because the shader preview could not create a WebGL renderer.'
        : `${model.status}: ${model.supportReason}`));
    return wrapper;
}

function createText(text: string): HTMLElement {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = 'max-width:760px;margin:4px auto 0;text-align:left;font-size:11px;color:var(--vscode-descriptionForeground);';
    return div;
}

function createBadge(text: string, kind: 'status' | 'template' | 'warning'): HTMLElement {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.cssText = [
        'font-size:11px',
        'padding:2px 6px',
        'border:1px solid var(--vscode-panel-border)',
        'border-radius:8px',
        kind === 'warning' ? 'color:var(--vscode-editorWarning-foreground)' : 'color:var(--vscode-descriptionForeground)',
    ].join(';');
    return span;
}

function createButton(text: string, title: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = title;
    return button;
}

function createRange(title: string, min: number, max: number, step: number, value: number): { label: HTMLLabelElement; input: HTMLInputElement; value: HTMLElement } {
    const label = document.createElement('label');
    label.title = title;
    label.style.cssText = 'display:flex;gap:4px;align-items:center;font-size:11px;';
    label.append(title);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.style.width = '110px';
    const valueElement = document.createElement('span');
    valueElement.style.cssText = 'min-width:46px;text-align:right;color:var(--vscode-descriptionForeground);';
    valueElement.textContent = value.toFixed(2);
    label.append(input, valueElement);
    return { label, input, value: valueElement };
}

function findTexture(model: UiShaderPreviewModel, role: string): UiShaderTextureBinding | undefined {
    return model.bindings.find(binding => binding.uri && binding.role === role);
}

function numberConstant(model: UiShaderPreviewModel, key: string, fallback: number): number {
    const value = model.controls.constants[key];
    return typeof value === 'number' ? value : fallback;
}

function vectorConstant(model: UiShaderPreviewModel, key: string, fallback: number[]): number[] {
    const value = model.controls.constants[key];
    return Array.isArray(value) ? [...value, ...fallback].slice(0, fallback.length) : fallback;
}

function templateId(template: string): number {
    if (template === 'arg-senate-animation') {
        return 1;
    }
    if (template === 'radial-progress') {
        return 2;
    }
    if (template === 'progress') {
        return 3;
    }
    if (template === 'rotating-notch') {
        return 4;
    }
    if (template === 'buttonstate-sprite-animation') {
        return 5;
    }
    return 0;
}

function effectId(effect: string): number {
    const normalized = effect.toLowerCase();
    if (normalized === 'down') {
        return 1;
    }
    if (normalized === 'over') {
        return 2;
    }
    if (normalized === 'disable') {
        return 3;
    }
    return 0;
}

function progressDirectionId(direction: string): number {
    if (direction === 'right-to-left') {
        return 1;
    }
    if (direction === 'top-to-bottom') {
        return 2;
    }
    if (direction === 'bottom-to-top') {
        return 3;
    }
    if (direction === 'radial-clockwise') {
        return 4;
    }
    if (direction === 'notch-clockwise') {
        return 5;
    }
    return 0;
}

function triangleWave(value: number): number {
    const phase = value % 2;
    return phase <= 1 ? phase : 2 - phase;
}

function updateProgressLabel(controls: Pick<PanelControls, 'progressValue'>, model: UiShaderPreviewModel, progress: number): void {
    const steps = typeof model.sprite.fields.steps === 'number' ? model.sprite.fields.steps : undefined;
    controls.progressValue.textContent = steps ? `${Math.round(progress * steps)}/${steps}` : progress.toFixed(2);
}
