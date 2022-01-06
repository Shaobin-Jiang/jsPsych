import autoBind from "auto-bind";
import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

const info = <const>{
  name: "sketchpad",
  parameters: {
    image: {
      type: ParameterType.IMAGE,
      default: undefined,
    },
    prompt: {
      type: ParameterType.HTML_STRING,
      default: null,
    },
    labels: {
      type: ParameterType.STRING,
      array: true,
      default: [],
    },
    regions: {
      type: ParameterType.COMPLEX,
      default: [],
      array: true,
    },
    colors: {
      type: ParameterType.STRING,
      array: true,
      default: [
        "#e41a1c",
        "#377eb8",
        "#4daf4a",
        "#984ea3",
        "#ff7f00",
        "#ffff33",
        "#a65628",
        "#f781bf",
      ],
    },
  },
};

type Info = typeof info;

/**
 * **image-text-annotaiton**
 *
 * jsPsych plugin for annotating an image with text labels
 *
 * @author Josh de Leeuw
 * @see {@link https://www.jspsych.org/latest/plugins/image-text-annotation/ image-text-annotation plugin documentation on jspsych.org}
 */
class ImageTextAnnotationPlugin implements JsPsychPlugin<Info> {
  static info = info;
  private img_container: HTMLElement;
  private is_drawing = false;
  private active_box: AnnotationBox;
  private boxes: Array<AnnotationBox> = [];
  private display_element: HTMLElement;
  private deselect_all_flag = true;
  private categories = [];
  private active_category = { id: null, label: "?", color: "#444" };
  private palette: Array<string>;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    this.display_element = display_element;
    this.palette = trial.colors;

    for (let i = 0; i < trial.labels.length; i++) {
      this.categories.push({
        id: i,
        color: trial.colors[i],
        label: trial.labels[i],
      });
    }

    this.add_css();
    this.renderDisplay(trial);
    this.addEvents(trial);

    for (const roi of trial.regions) {
      const box = new AnnotationBox(roi.left, roi.top, this.boxes, this.img_container, this);
      box.setEndCoords(roi.right, roi.bottom);
      box.finishDrawing();
      box.setLabel(roi.label ? roi.label : "?");
      box.setModifiable(false);
    }
  }

  private renderDisplay(trial) {
    let html = `<div id="jspsych-annotation-display">`;
    if (trial.prompt !== null) {
      html += `<div id='instructions'>${trial.prompt}</div>`;
    }
    html += `
      <div id='main-display'>
        <div id='annotated-image-container'>
          <img src="${trial.image}" draggable="false"></img>
        </div>
        <div id='annotation-options'>
    `;
    let i = 0;
    for (const l of trial.labels) {
      html += `<div style="--main-color:${trial.colors[i]}"><input type="radio" id="opt${i}" name="annotate_label" value="${l}"><label for="opt${i}">${l}</label></div>`;
      i++;
    }
    // html += `
    //       <div><input type="radio" id="opt${i}" name="annotate_label" value=""><label for="opt${i}"><input id="opt${i}_text" type="text"></label></div>
    // `;
    html += `
        </div>
      </div>
    `;
    html += `</div>`;

    this.display_element.innerHTML = html;

    this.add_new_label();

    this.img_container = this.display_element.querySelector("#annotated-image-container");
  }

  private addEvents(trial) {
    this.img_container.addEventListener("mousedown", this.start_box);

    const radios = this.display_element.querySelectorAll('input[type="radio"]');
    for (const r of Array.from(radios)) {
      r.addEventListener("change", this.handle_radio_change);
    }

    this.img_container.addEventListener("mousemove", this.sort_boxes);

    document.addEventListener("mousedown", () => {
      this.deselect_all_flag = true;
    });
    document.addEventListener("click", this.deselect_all);
  }

  private add_css() {
    document.querySelector("head").insertAdjacentHTML(
      "beforeend",
      `<style id="image-text-annotation-styles">
        #jspsych-annotation-display #main-display {
          display: flex;
        }

        #jspsych-annotation-display #annotation-options div {
          margin-bottom: 0.5em;
        }

        #jspsych-annotation-display input[type="radio"] {
          display: none;
        }

        #jspsych-annotation-display label {
          border-radius: 0.75em;
          background-color: var(--main-color);
          color: white;
          padding: 0.35em 0.5em;
          margin-bottom: 0.25em;
          cursor: pointer;
          display: block;
          line-height: normal;
          transition: margin-right 0.2s;
        }

        #jspsych-annotation-display input[type="radio"] + label::before {
          content: url('data:image/svg+xml; utf8, <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M20.285 2l-11.285 11.567-5.286-5.011-3.714 3.716 9 8.728 15-15.285z"/></svg>');
          display: inline-block;
          padding-right: 0.5em;
          position: relative;
          top: 0.15em;
          transform: scale(0);
          transition: transform 0.2s;
        }

        #jspsych-annotation-display input[type="radio"]:checked + label::before {
          transform: scale(1);
        }

        #jspsych-annotation-display label input[type="text"] {
          background: none;
          border: none;
          color: white;
          font-size: 18px;
          margin: 0;
          padding:0;
        }

        #jspsych-annotation-display label input[type="text"]:hover {
          border-bottom: 1px solid white;
        }

        #jspsych-annotation-display label input[type="text"]:active, 
        #jspsych-annotation-display label input[type="text"]:focus,
        #jspsych-annotation-display label input[type="text"]:focus-visible {
          border-bottom: 1px solid white;
          outline: none;
        }

        #jspsych-annotation-display #annotated-image-container {
          cursor: crosshair;
          position: relative;
        }

        #jspsych-annotation-display #annotated-image-container img {
          user-select: none;
          display: block;
        }

        #jspsych-annotation-display #annotated-image-container .annotation-box {
          border: 1px solid var(--main-color);
          position: absolute;
          color: var(--main-color);
          user-select: none;
          background-color: var(--very-transparent-color);
        }

        #jspsych-annotation-display #annotated-image-container .annotation-box:hover {
          
        }

        .annotation-box-label {
          font-size:10px;
          font-family:monospace;
          text-align:left;
          line-height:1em;
          color: white;
          background-color: var(--main-color);
          border-radius: 5px;
          border: 1px solid var(--main-color);
          box-shadow: 1px 1px 3px rgba(0,0,0,0.5);
          position:absolute;
          top:2px;
          left:2px;
          padding: 0.5em;
          user-select: none;
          cursor: pointer;
          visibility: hidden;
        }

        .annotation-box-label:hover {
          filter: brightness(110%);
        }

        .annotation-box-label.selected {
          border: 1px solid white;
        }

        .annotation-box::before {
          content: "";
          position: absolute;
          height: calc(100% + 8px);
          width: calc(100% + 8px);
          top: -4px;
          left: -4px;
        }

        .annotation-box-remove {
          visibility: hidden;
          user-select: none;
          font-size: 10px;
          font-family: monospace;
          margin: 0px;
          text-align: center;
          line-height: 1em;
          position: absolute;
          top: 2px;
          right: 2px;
          background-color: white;
          color: #777;
          border-radius: 3px;
          box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.5);
          padding: 0.5em;
          text-align: center;
          cursor: pointer;
        }

        .annotation-box-remove:hover {
          background-color: #eee;
        }

        .annotation-box-resize {
          visibility: hidden;
          width: 4px;
          height: 4px;
          background-color: var(--transparent-color);
          border: 1px solid var(--transparent-color);
          position: absolute;
          user-select: none;
          transition: height 0.25s, width 0.25s, left 0.25s, top 0.25s, right 0.25s, bottom 0.25s;
        }
        
        .annotation-box-resize:hover {
          width: 14px;
          height:14px;
        }

        .annotation-box-resize.top.left, .annotation-box-resize.bottom.right {
          cursor: nwse-resize;
        }

        .annotation-box-resize.top.right, .annotation-box-resize.bottom.left {
          cursor: nesw-resize;
        }

        .annotation-box-resize.left {
          left: -3px;
        }

        .annotation-box-resize.top {
          top: -3px;
        }

        .annotation-box-resize.right {
          right: -3px;
        }

        .annotation-box-resize.bottom {
          bottom: -3px;
        }

        .annotation-box-resize.left:hover {
          left: -8px;
        }

        .annotation-box-resize.top:hover {
          top: -8px;
        }

        .annotation-box-resize.right:hover {
          right: -8px;
        }

        .annotation-box-resize.bottom:hover {
          bottom: -8px;
        }

        .annotation-box-resize::before {
          content: "";
          position: absolute;
          height: calc(100% + 12px);
          width: calc(100% + 12px);
          top: -6px;
          left: -6px;
        }

        .annotation-box.modifiable:hover .annotation-box-remove {
          visibility: visible; 
        }

        .annotation-box.modifiable:hover .annotation-box-resize {
          visibility: visible;
        }

        .annotation-box:hover .annotation-box-label {
          visibility: visible;
        }

        #jspsych-annotation-display #annotation-options {
          text-align: left;
          padding-left: 24px;
        }
      </style>`
    );
  }

  private start_box(e) {
    const x = Math.round(e.clientX - this.img_container.getBoundingClientRect().left);
    const y = Math.round(e.clientY - this.img_container.getBoundingClientRect().top);

    this.is_drawing = true;

    this.active_box = new AnnotationBox(x, y, this.boxes, this.img_container, this);

    this.img_container.addEventListener("mousemove", this.move_box);
    this.img_container.addEventListener("mouseup", this.stop_box);
  }

  private move_box(e) {
    if (this.is_drawing) {
      const x = Math.round(e.clientX - this.img_container.getBoundingClientRect().left);
      const y = Math.round(e.clientY - this.img_container.getBoundingClientRect().top);

      this.active_box.setEndCoords(x, y);
    }
  }

  private stop_box() {
    if (this.is_drawing) {
      this.active_box.finishDrawing();

      this.active_box.setCategory(this.active_category);

      this.active_box.select();

      this.active_box = null;
      this.img_container.removeEventListener("mousemove", this.move_box);

      this.is_drawing = false;
      this.deselect_all_flag = false;
    }
  }

  private sort_boxes() {
    const original_order = this.boxes.map((box) => box.area());
    const sizes = this.boxes.map((box) => box.area());
    sizes.sort((a, b) => b - a);

    let z = 0;
    for (const s of sizes) {
      this.boxes[original_order.indexOf(s)].setZIndex(z.toString());
      z++;
    }
  }

  select_label(label: string) {
    const radio: HTMLFormElement = this.display_element.querySelector(`input[value='${label}']`);
    if (radio) {
      radio.checked = true;
    } else {
      const radios = this.display_element.querySelectorAll('input[type="radio"]');
      for (const r of Array.from(radios)) {
        (r as HTMLFormElement).checked = false;
      }
    }
  }

  private handle_radio_change(e) {
    this.active_category = this.categories[(e.target as HTMLFormElement).id.substring(3, 4)];
    for (const b of this.boxes) {
      if (b.isSelected()) {
        b.setCategory(this.active_category);
      }
    }
  }

  private deselect_all(e) {
    if (this.deselect_all_flag && !["RADIO", "LABEL", "INPUT"].includes(e.target.tagName)) {
      for (const b of this.boxes) {
        b.deselect();
      }
    }
  }

  private add_new_label(e?) {
    const container = this.display_element.querySelector("#annotation-options");
    const category_id = this.categories.length;

    this.categories.push({
      id: category_id,
      label: "",
      color: this.palette[category_id],
    });

    const html = `
      <div style="--main-color: ${this.palette[category_id]}"><input type="radio" id="opt${category_id}" name="annotate_label" value=""><label for="opt${category_id}"><input id="opt${category_id}_text" type="text"></label></div>
    `;
    container.insertAdjacentHTML("beforeend", html);
    container
      .querySelector(`#opt${category_id}_text`)
      .addEventListener("change", this.add_new_label);
    container
      .querySelector(`#opt${category_id}_text`)
      .addEventListener("change", this.update_labels);
    container.querySelector(`#opt${category_id}_text`).addEventListener("click", (e) => {
      (e.target as HTMLFormElement).parentElement.parentElement.querySelector("input").checked =
        true;
    });

    if (e) {
      e.target.removeEventListener("change", this.add_new_label);
    }

    container
      .querySelector(`#opt${category_id}`)
      .addEventListener("change", this.handle_radio_change);
  }

  private update_labels(e) {
    const text = e.target as HTMLFormElement;
    const radio = text.parentElement.parentElement.querySelector(
      'input[type="radio"]'
    ) as HTMLFormElement;

    const old_label = radio.value;
    const new_label = text.value;

    for (const b of this.boxes) {
      if (b.getLabel() == old_label) {
        b.setLabel(new_label);
      }
    }

    radio.value = new_label;
  }
}

class AnnotationBox {
  private label = "?";
  private element: HTMLElement;
  private start_x;
  private start_y;
  private end_x;
  private end_y;
  private drag_offset_x;
  private drag_offset_y;
  private box_list: Array<AnnotationBox>;
  private container: HTMLElement;
  private selected = false;
  private plugin: ImageTextAnnotationPlugin;
  private modifiable = true;
  private color = "#444444";
  private category = null;

  constructor(x, y, box_list, container, plugin) {
    autoBind(this);

    this.container = container;
    this.box_list = box_list;
    this.plugin = plugin;

    this.setAnchorCoords(x, y);

    const el = document.createElement("div");
    el.classList.add("annotation-box", "modifiable");
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    this.element = el;

    this.setColor(this.color);

    this.container.appendChild(this.element);
  }

  setModifiable(modifiable: boolean) {
    this.modifiable = modifiable;
    if (modifiable) {
      this.element.classList.add("modifiable");
    } else {
      this.element.classList.remove("modifiable");
    }
  }

  setCategory(category) {
    this.category = category.id;
    this.setLabel(category.label);
    this.setColor(category.color);
  }

  setColor(color) {
    this.element.style.setProperty("--main-color", color);
    this.element.style.setProperty("--transparent-color", color + "80");
    this.element.style.setProperty("--very-transparent-color", color + "40");
  }

  setLabel(label) {
    if (label) {
      this.label = label;
    }
    this.element.querySelector(".annotation-box-label").innerHTML = this.label;
  }

  getLabel() {
    return this.label;
  }

  getElement() {
    return this.element;
  }

  setAnchorCoords(x, y) {
    this.start_x = x;
    this.start_y = y;
  }

  setEndCoords(x, y) {
    this.end_x = x;
    this.end_y = y;

    this.updateRenderLocation();
  }

  translate(x, y) {
    this.start_x += x;
    this.start_y += y;

    this.end_x += x;
    this.end_y += y;

    this.updateRenderLocation();
  }

  updateRenderLocation() {
    this.element.style.width = `${Math.abs(this.end_x - this.start_x)}px`;
    this.element.style.height = `${Math.abs(this.end_y - this.start_y)}px`;

    if (this.start_x <= this.end_x) {
      this.element.style.left = `${this.start_x}px`;
    } else {
      this.element.style.left = `${this.end_x}px`;
    }

    if (this.start_y <= this.end_y) {
      this.element.style.top = `${this.start_y}px`;
    } else {
      this.element.style.top = `${this.end_y}px`;
    }
  }

  finishDrawing() {
    this.element.innerHTML = `
      <span class="annotation-box-label"></span>
      <span class="annotation-box-remove">X</span>
      <div class="annotation-box-resize top left"></div>
      <div class="annotation-box-resize top right"></div>
      <div class="annotation-box-resize bottom left"></div>
      <div class="annotation-box-resize bottom right"></div>
    `;

    this.box_list.push(this);

    this.addEvents();
  }

  addEvents() {
    this.element.querySelector(".annotation-box-remove").addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    this.element.querySelector(".annotation-box-remove").addEventListener("mouseup", (e) => {
      e.stopPropagation();
    });
    this.element.querySelector(".annotation-box-remove").addEventListener("click", (e) => {
      e.preventDefault();
      this.remove();
    });

    this.element
      .querySelector(".annotation-box-resize.bottom.right")
      .addEventListener("mousedown", (e) => {
        const coords = this.element.getBoundingClientRect();
        const container = this.container.getBoundingClientRect();
        this.setAnchorCoords(coords.left - container.left, coords.top - container.top);
        e.stopPropagation();
        this.startMove();
      });

    this.element
      .querySelector(".annotation-box-resize.bottom.left")
      .addEventListener("mousedown", (e) => {
        const coords = this.element.getBoundingClientRect();
        const container = this.container.getBoundingClientRect();
        this.setAnchorCoords(coords.right - container.left, coords.top - container.top);
        e.stopPropagation();
        this.startMove();
      });

    this.element
      .querySelector(".annotation-box-resize.top.right")
      .addEventListener("mousedown", (e) => {
        const coords = this.element.getBoundingClientRect();
        const container = this.container.getBoundingClientRect();
        this.setAnchorCoords(coords.left - container.left, coords.bottom - container.top);
        e.stopPropagation();
        this.startMove();
      });

    this.element
      .querySelector(".annotation-box-resize.top.left")
      .addEventListener("mousedown", (e) => {
        const coords = this.element.getBoundingClientRect();
        const container = this.container.getBoundingClientRect();
        this.setAnchorCoords(coords.right - container.left, coords.bottom - container.top);
        e.stopPropagation();
        this.startMove();
      });

    this.container.addEventListener("mouseup", () => {
      this.stopMove();
    });

    this.element.querySelector(".annotation-box-label").addEventListener("click", (e) => {
      e.stopPropagation();
      this.select();
    });

    this.element.querySelector(".annotation-box-label").addEventListener("mousedown", (e) => {
      if (this.modifiable) {
        this.startDrag(e);
      }
      e.stopPropagation();
    });
  }

  startMove() {
    this.container.addEventListener("mousemove", this.moveHandler);
  }

  moveHandler(e) {
    const container = this.container.getBoundingClientRect();

    let x = Math.round(e.clientX - container.left);
    let y = Math.round(e.clientY - container.top);

    x = Math.min(x, container.width);
    x = Math.max(x, 0);

    y = Math.min(y, container.height);
    y = Math.max(y, 0);

    this.setEndCoords(x, y);
  }

  stopMove() {
    this.container.removeEventListener("mousemove", this.moveHandler);
  }

  startDrag(e) {
    this.drag_offset_x = Math.round(e.clientX - this.element.getBoundingClientRect().left);
    this.drag_offset_y = Math.round(e.clientY - this.element.getBoundingClientRect().top);

    this.container.addEventListener("mousemove", this.dragHandler);
    this.container.addEventListener("mouseup", this.stopDrag);
  }

  stopDrag() {
    this.container.removeEventListener("mousemove", this.dragHandler);
    this.container.removeEventListener("mouseup", this.stopDrag);
  }

  dragHandler(e) {
    const box = this.element.getBoundingClientRect();
    const container = this.container.getBoundingClientRect();

    const box_rel = {
      left: box.left - container.left,
      top: box.top - container.top,
    };

    const x = Math.round(e.clientX - container.left);
    const y = Math.round(e.clientY - container.top);

    let dx = x - this.drag_offset_x - box_rel.left;
    let dy = y - this.drag_offset_y - box_rel.top;

    dx = Math.min(dx, container.width - box_rel.left - box.width);
    dx = Math.max(dx, -box_rel.left);

    dy = Math.min(dy, container.height - box_rel.top - box.height);
    dy = Math.max(dy, -box_rel.top);

    this.translate(dx, dy);
  }

  area() {
    const { width, height } = this.element.getBoundingClientRect();
    return width * height;
  }

  setZIndex(z: string) {
    this.element.style.zIndex = z;
  }

  remove() {
    this.element.remove();
    this.box_list = this.box_list.filter((x) => {
      x !== this;
    });
  }

  select() {
    for (const b of this.box_list) {
      b.deselect();
    }
    this.selected = true;
    this.element.querySelector(".annotation-box-label").classList.add("selected");
    this.plugin.select_label(this.label);
  }

  deselect() {
    this.selected = false;
    this.element.querySelector(".annotation-box-label").classList.remove("selected");
  }

  isSelected() {
    return this.selected;
  }

  showResizeHandles() {
    const handles = this.element.querySelectorAll(".annotation-box-resize");
    // for(const h of handles){
    //   h.style.visibility = 'visible';
    // }
  }
}

export default ImageTextAnnotationPlugin;