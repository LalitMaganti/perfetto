// Copyright (C) 2026 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import m from 'mithril';
import type {UiHierarchyNode} from './ui_hierarchy_data';
import type {
  UiHierarchySession,
  UiHierarchyViewOptions,
} from './ui_hierarchy_session';

interface Pt {
  x: number;
  y: number;
}

interface P3 {
  x: number;
  y: number;
  d: number;
}

interface HitRect {
  nodeId: string;
  q: Pt[];
  order: number;
  area: number;
}

interface LabelHit {
  nodeId: string;
  x0: number;
  y0: number;
  y1: number;
}

export interface UiHierarchyRectsAttrs {
  readonly session: UiHierarchySession;
  readonly nodes: UiHierarchyNode[];
  readonly selectedNodeId?: string;
  readonly onSelect: (nodeId: string) => void;
  readonly options: UiHierarchyViewOptions;
}

export class UiHierarchyRectsView implements m.ClassComponent<UiHierarchyRectsAttrs> {
  private canvas?: HTMLCanvasElement;
  private hit: HitRect[] = [];
  private labelHit: LabelHit[] = [];

  oncreate(vnode: m.VnodeDOM<UiHierarchyRectsAttrs>): void {
    const el = vnode.dom.querySelector<HTMLCanvasElement>(
      'canvas.pf-uih-rects-canvas',
    );
    if (el) {
      this.canvas = el;
      this.draw(vnode.attrs);
    }
  }

  onupdate(vnode: m.VnodeDOM<UiHierarchyRectsAttrs>): void {
    const el = vnode.dom.querySelector<HTMLCanvasElement>(
      'canvas.pf-uih-rects-canvas',
    );
    if (el) {
      this.canvas = el;
      this.draw(vnode.attrs);
    }
  }

  onremove(): void {
    this.canvas = undefined;
  }

  view(vnode: m.Vnode<UiHierarchyRectsAttrs>): m.Children {
    return m(
      '.pf-uih-rects-wrapper',
      {
        style:
          'display:flex; flex-direction:row; width:100%; height:100%; overflow:hidden; position:relative;',
      },
      [
        m(
          '.pf-uih-canvas-pane',
          {
            style:
              'flex: 1 1 100%; width:100%; height:100%; position:relative; overflow:hidden;',
          },
          [
            m('canvas.pf-uih-rects-canvas', {
              style:
                'width:100%; height:100%; display:block; cursor:crosshair;',
              onclick: (e: MouseEvent) => this.handleClick(e, vnode.attrs),
            }),
          ],
        ),
      ],
    );
  }

  private handleClick(e: MouseEvent, attrs: UiHierarchyRectsAttrs): void {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    // Check label gutter first.
    for (const lh of this.labelHit) {
      if (x >= lh.x0 && y >= lh.y0 && y <= lh.y1) {
        attrs.onSelect(lh.nodeId);
        return;
      }
    }

    // Check rect hits. Pick smallest area among matching polygons (innermost / topmost node).
    const matches: HitRect[] = [];
    for (const hr of this.hit) {
      if (pointInPoly({x, y}, hr.q)) {
        matches.push(hr);
      }
    }
    if (matches.length > 0) {
      matches.sort((a, b) => a.area - b.area || b.order - a.order);
      attrs.onSelect(matches[0].nodeId);
    }
  }

  private draw(attrs: UiHierarchyRectsAttrs): void {
    const c = this.canvas;
    if (!c) return;
    const pr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    if (
      c.width !== Math.round(cssW * pr) ||
      c.height !== Math.round(cssH * pr)
    ) {
      c.width = Math.round(cssW * pr);
      c.height = Math.round(cssH * pr);
    }

    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.resetTransform();
    ctx.scale(pr, pr);
    ctx.clearRect(0, 0, cssW, cssH);

    let nodes = attrs.nodes;
    if (attrs.options.onlyVisible) {
      nodes = nodes.filter((n) => n.isVisible);
    }
    if (attrs.options.onlyClickable) {
      nodes = nodes.filter((n) => n.isClickable);
    }

    // Filter nodes with valid positive dimensions.
    const items = nodes
      .filter(
        (n) => n.boundsRight > n.boundsLeft && n.boundsBottom > n.boundsTop,
      )
      .map((n, idx) => ({
        n,
        q: [
          {x: n.boundsLeft, y: n.boundsTop},
          {x: n.boundsRight, y: n.boundsTop},
          {x: n.boundsRight, y: n.boundsBottom},
          {x: n.boundsLeft, y: n.boundsBottom},
        ],
        idx,
      }));

    if (items.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'No rects to display for current filter.',
        cssW / 2,
        cssH / 2,
      );
      return;
    }

    const gutterW = Math.min(200, Math.max(100, Math.floor(cssW * 0.28)));
    const sceneW = cssW - gutterW;

    if (attrs.options.projection3d) {
      this.draw3d(ctx, items, attrs, sceneW, cssH, gutterW);
    } else {
      this.draw2d(ctx, items, attrs, sceneW, cssH, gutterW);
    }
  }

  private draw2d(
    ctx: CanvasRenderingContext2D,
    items: Array<{n: UiHierarchyNode; q: Pt[]; idx: number}>,
    attrs: UiHierarchyRectsAttrs,
    sceneW: number,
    cssH: number,
    gutterW: number,
  ): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      for (const p of item.q) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }

    const margin = 20;
    const sw = maxX - minX || 1;
    const sh = maxY - minY || 1;
    const scale = Math.min(
      (sceneW - 2 * margin) / sw,
      (cssH - 2 * margin) / sh,
    );
    const offX = margin + (sceneW - 2 * margin - sw * scale) / 2 - minX * scale;
    const offY = margin + (cssH - 2 * margin - sh * scale) / 2 - minY * scale;

    const toScreen = (p: Pt): Pt => ({
      x: offX + p.x * scale,
      y: offY + p.y * scale,
    });

    this.hit = [];
    const drawn = items.map((item, order) => {
      const sq = item.q.map(toScreen);
      const w = Math.abs(sq[1].x - sq[0].x);
      const h = Math.abs(sq[2].y - sq[1].y);
      const area = w * h;
      this.hit.push({nodeId: item.n.nodeId, q: sq, order, area});
      return {
        n: item.n,
        sq,
        order,
        area,
        selected: item.n.nodeId === attrs.selectedNodeId,
      };
    });

    for (const d of drawn) {
      this.renderRect(
        ctx,
        d.sq,
        d.n,
        d.selected,
        attrs.options.shading,
        d.order,
        drawn.length,
      );
    }

    this.drawLeaderLabels(ctx, drawn, sceneW, cssH, gutterW);
  }

  private draw3d(
    ctx: CanvasRenderingContext2D,
    items: Array<{n: UiHierarchyNode; q: Pt[]; idx: number}>,
    attrs: UiHierarchyRectsAttrs,
    sceneW: number,
    cssH: number,
    gutterW: number,
  ): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      for (const p of item.q) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    const zStep = 18 + attrs.options.explode * 120;
    const mz = ((items.length - 1) * zStep) / 2;

    const pitch = (attrs.options.rotation * Math.PI) / 8;
    const yaw = 1.5 * pitch;
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);

    const project = (x: number, y: number, z: number): P3 => {
      const X = x - mx;
      const Y = y - my;
      const Z = z - mz;
      const X1 = X * cy + Z * sy;
      const Z1 = -X * sy + Z * cy;
      const Y2 = Y * cx - Z1 * sx;
      const Z2 = Y * sx + Z1 * cx;
      return {x: X1, y: Y2, d: Z2};
    };

    const proj = items.map((item, i) => {
      const z = i * zStep;
      const ps = item.q.map((p) => project(p.x, p.y, z));
      const depth = ps.reduce((s, p) => s + p.d, 0) / ps.length;
      return {n: item.n, ps, depth, originalIdx: i};
    });

    let pMinX = Infinity;
    let pMinY = Infinity;
    let pMaxX = -Infinity;
    let pMaxY = -Infinity;
    for (const p of proj) {
      for (const pt of p.ps) {
        pMinX = Math.min(pMinX, pt.x);
        pMinY = Math.min(pMinY, pt.y);
        pMaxX = Math.max(pMaxX, pt.x);
        pMaxY = Math.max(pMaxY, pt.y);
      }
    }

    const margin = 20;
    const sw = pMaxX - pMinX || 1;
    const sh = pMaxY - pMinY || 1;
    const scale = Math.min(
      (sceneW - 2 * margin) / sw,
      (cssH - 2 * margin) / sh,
    );
    const offX =
      margin + (sceneW - 2 * margin - sw * scale) / 2 - pMinX * scale;
    const offY = margin + (cssH - 2 * margin - sh * scale) / 2 - pMinY * scale;

    const toScreen = (p: P3): Pt => ({
      x: offX + p.x * scale,
      y: offY + p.y * scale,
    });

    proj.sort((a, b) => a.depth - b.depth);

    this.hit = [];
    const drawn = proj.map((d, order) => {
      const sq = d.ps.map(toScreen);
      const area = polygonArea(sq);
      this.hit.push({nodeId: d.n.nodeId, q: sq, order, area});
      return {
        n: d.n,
        sq,
        order,
        area,
        selected: d.n.nodeId === attrs.selectedNodeId,
      };
    });

    for (const d of drawn) {
      this.renderRect(
        ctx,
        d.sq,
        d.n,
        d.selected,
        attrs.options.shading,
        d.order,
        drawn.length,
      );
    }

    this.drawLeaderLabels(ctx, drawn, sceneW, cssH, gutterW);
  }

  private renderRect(
    ctx: CanvasRenderingContext2D,
    sq: Pt[],
    n: UiHierarchyNode,
    selected: boolean,
    shading: string,
    order: number,
    total: number,
  ): void {
    const baseColor = colorForKind(n.kind);
    ctx.beginPath();
    ctx.moveTo(sq[0].x, sq[0].y);
    for (let i = 1; i < sq.length; i++) ctx.lineTo(sq[i].x, sq[i].y);
    ctx.closePath();

    if (shading !== 'wireframe') {
      if (selected) {
        ctx.fillStyle = 'rgba(255, 235, 59, 0.45)';
      } else if (shading === 'gradient') {
        const k = 0.4 + 0.6 * (order / Math.max(1, total - 1));
        ctx.fillStyle = adjustRgb(baseColor, k, n.isVisible ? 0.4 : 0.15);
      } else {
        ctx.fillStyle = adjustRgb(baseColor, 1.0, n.isVisible ? 0.35 : 0.12);
      }
      ctx.fill();
    }

    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.strokeStyle = selected ? '#ffd600' : baseColor;
    ctx.stroke();
  }

  private drawLeaderLabels(
    ctx: CanvasRenderingContext2D,
    drawn: Array<{
      n: UiHierarchyNode;
      sq: Pt[];
      order: number;
      selected: boolean;
    }>,
    sceneW: number,
    cssH: number,
    gutterW: number,
  ): void {
    this.labelHit = [];
    const labelAll = drawn.length <= 25;
    let cands = drawn.filter((d) =>
      labelAll ? d.selected || d.n.isVisible : d.selected,
    );
    cands.sort(
      (a, b) =>
        (b.selected ? 1 : 0) - (a.selected ? 1 : 0) || b.order - a.order,
    );

    const lineH = 16;
    const pad = 8;
    const maxLabels = Math.max(0, Math.floor((cssH - 2 * pad) / lineH));
    cands = cands.slice(0, maxLabels);
    if (cands.length === 0) return;

    const anchorOf = (sq: Pt[]) =>
      sq.reduce((b, p) => (p.x > b.x ? p : b), sq[0]);
    const placed = cands
      .map((d) => ({d, ax: anchorOf(d.sq).x, ay: anchorOf(d.sq).y, y: 0}))
      .sort((a, b) => a.ay - b.ay);

    let nextMin = pad;
    for (let i = 0; i < placed.length; i++) {
      const remaining = placed.length - 1 - i;
      const maxY = cssH - pad - 3 - remaining * lineH;
      let y = Math.max(placed[i].ay, nextMin);
      if (y > maxY) y = maxY;
      placed[i].y = y;
      nextMin = y + lineH;
    }

    const labelX = sceneW + 10;
    const maxTextW = gutterW - 18;
    for (const it of placed) {
      this.labelHit.push({
        nodeId: it.d.n.nodeId,
        x0: sceneW,
        y0: it.y - lineH + 3,
        y1: it.y + 4,
      });

      const strong = it.d.selected;
      const col = strong ? '#ffd600' : colorForKind(it.d.n.kind);

      ctx.strokeStyle = col;
      ctx.lineWidth = strong ? 1.5 : 1;
      ctx.globalAlpha = strong ? 0.95 : 0.55;
      ctx.beginPath();
      ctx.moveTo(it.ax, it.ay);
      ctx.lineTo(labelX - 4, it.y - 4);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(it.ax, it.ay, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      ctx.font = `${strong ? 'bold ' : ''}11px sans-serif`;
      const labelText = fitText(
        ctx,
        it.d.n.name || `Node ${it.d.n.nodeId}`,
        maxTextW,
      );
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(labelText, labelX, it.y);
      ctx.fillStyle = strong ? '#ffd600' : '#e0e0e0';
      ctx.fillText(labelText, labelX, it.y);
    }
  }
}

function colorForKind(kind: number): string {
  switch (kind) {
    case 1:
      return '#00bcd4'; // Cyan for View
    case 2:
      return '#9c27b0'; // Purple for ComposeView
    case 3:
      return '#4caf50'; // Green for ComposeNode
    case 4:
      return '#ff9800'; // Amber for Composable
    default:
      return '#607d8b';
  }
}

function adjustRgb(hexColor: string, factor: number, alpha: number): string {
  const r = Math.round(parseInt(hexColor.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hexColor.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hexColor.slice(5, 7), 16) * factor);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: Pt[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return Math.abs(area / 2);
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) {
    s = s.slice(0, -1);
  }
  return s + '…';
}
