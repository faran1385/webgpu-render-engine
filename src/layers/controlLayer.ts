import {BaseLayer} from "./baseLayer.ts";
import {BindingParams} from "@tweakpane/core";


type controlType = BindingParams & {
    defaultValue: boolean | number | string,
    onChange: (value: any) => void,
}

export type controls = Record<string, controlType>

export class ControlLayer extends BaseLayer {
    private static guiControls: controls = {};
    private static _currentValues: Record<string, boolean | number | string> = {};


    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);
    }

    public set addControl({name, control}: { name: string, control: controlType }) {
        ControlLayer.guiControls[name] = control;
    }


    private static set addToCurrent({key, value}: { key: string, value: string | boolean | number }) {
        ControlLayer._currentValues[key] = value;
    }

    public get currentValues() {
        return ControlLayer._currentValues;
    }

    public init(): void {
        for (let key in ControlLayer.guiControls) {
            const binding = ControlLayer.guiControls[key];
            ControlLayer.addToCurrent = {key, value: binding.defaultValue};
            ControlLayer.pane.addBinding(this.currentValues, key, binding).on("change", (targetBind) => binding.onChange(targetBind.value))

        }
    }

}