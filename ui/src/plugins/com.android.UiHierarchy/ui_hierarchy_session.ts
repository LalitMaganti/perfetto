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
import type {Trace} from '../../public/trace';
import {
  computeVersionDiffs,
  type NodeVersionChange,
  queryNodesAt,
  queryNodeVersions,
  querySnapshots,
  queryWindows,
  type UiHierarchyNode,
  type UiHierarchySnapshot,
  type UiHierarchyWindow,
} from './ui_hierarchy_data';

export interface UiHierarchyViewOptions {
  projection3d: boolean;
  onlyVisible: boolean;
  onlyClickable: boolean;
  shading: 'solid' | 'gradient' | 'wireframe';
  explode: number; // 0..1
  rotation: number; // 0..1
  searchQuery: string;
  kindFilter?: number;
  showVersionDiff: boolean;
}

export class UiHierarchySession {
  readonly trace: Trace;
  windows: UiHierarchyWindow[] = [];
  selectedProcessUpid?: number;
  selectedWindowKey?: string;
  snapshots: UiHierarchySnapshot[] = [];
  index = 0;

  nodes: UiHierarchyNode[] = [];
  byRowId = new Map<number, UiHierarchyNode>();
  byNodeId = new Map<string, UiHierarchyNode>();

  selectedNodeId?: string;
  nodeVersions: UiHierarchyNode[] = [];
  nodeVersionChanges: NodeVersionChange[] = [];

  loading = false;

  private loadToken = 0;
  private nodeToken = 0;

  readonly options: UiHierarchyViewOptions = {
    projection3d: false,
    onlyVisible: false,
    onlyClickable: false,
    shading: 'gradient',
    explode: 0.3,
    rotation: 0.25,
    searchQuery: '',
    kindFilter: undefined,
    showVersionDiff: false,
  };

  constructor(trace: Trace) {
    this.trace = trace;
  }

  get processes(): {
    upid: number;
    pid?: number;
    processName?: string;
    windowCount: number;
  }[] {
    const map = new Map<
      number,
      {upid: number; pid?: number; processName?: string; windowCount: number}
    >();
    for (const w of this.windows) {
      const existing = map.get(w.upid);
      if (existing) {
        existing.windowCount++;
      } else {
        map.set(w.upid, {
          upid: w.upid,
          pid: w.pid,
          processName: w.processName,
          windowCount: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.upid - b.upid);
  }

  get windowsForSelectedProcess(): UiHierarchyWindow[] {
    if (this.selectedProcessUpid === undefined) return this.windows;
    const filtered = this.windows.filter(
      (w) => w.upid === this.selectedProcessUpid,
    );
    return filtered.length > 0 ? filtered : this.windows;
  }

  get selectedWindow(): UiHierarchyWindow | undefined {
    return (
      this.windows.find((w) => w.key === this.selectedWindowKey) ??
      this.windowsForSelectedProcess[0] ??
      this.windows[0]
    );
  }

  get currentSnapshot(): UiHierarchySnapshot | undefined {
    return this.snapshots[this.index];
  }

  get selectedNode(): UiHierarchyNode | undefined {
    return this.selectedNodeId !== undefined
      ? this.byNodeId.get(this.selectedNodeId)
      : undefined;
  }

  async init(): Promise<void> {
    this.windows = await queryWindows(this.trace.engine);

    if (this.windows.length > 0) {
      const def = this.windows[0];
      this.selectedProcessUpid = def.upid;
      this.selectedWindowKey = def.key;

      await this.setWindow(def.key);
    }
  }

  async setProcess(upid: number): Promise<void> {
    this.selectedProcessUpid = upid;
    const matching = this.windows.filter((w) => w.upid === upid);
    if (matching.length > 0) {
      if (!matching.some((w) => w.key === this.selectedWindowKey)) {
        await this.setWindow(matching[0].key);
        return;
      }
    }
    m.redraw();
  }

  async setWindow(key: string): Promise<void> {
    const token = ++this.loadToken;
    this.selectedWindowKey = key;
    const win = this.selectedWindow;
    if (!win) return;
    this.selectedProcessUpid = win.upid;

    const prevTs = this.currentSnapshot?.ts;
    const snapshots = await querySnapshots(this.trace.engine, win.upid);
    if (token !== this.loadToken) return;
    this.snapshots = snapshots;

    if (prevTs !== undefined) {
      await this.setNearestTs(prevTs);
    } else {
      await this.loadIndex(0, token);
    }
  }

  async setIndex(i: number): Promise<void> {
    await this.loadIndex(i, ++this.loadToken);
  }

  async setNearestTs(ts: bigint): Promise<void> {
    if (this.snapshots.length === 0) return;
    let best = 0;
    let bestD = -1n;
    for (let i = 0; i < this.snapshots.length; i++) {
      const snapTs = this.snapshots[i].ts;
      const d = snapTs > ts ? snapTs - ts : ts - snapTs;
      if (bestD < 0n || d < bestD) {
        bestD = d;
        best = i;
      }
    }
    await this.loadIndex(best, ++this.loadToken);
  }

  private async loadIndex(i: number, token: number): Promise<void> {
    if (token !== this.loadToken) return;
    if (this.snapshots.length === 0) {
      this.index = 0;
      this.nodes = [];
      this.byRowId.clear();
      this.byNodeId.clear();
      this.loading = false;
      m.redraw();
      return;
    }

    this.index = Math.max(0, Math.min(i, this.snapshots.length - 1));
    const snap = this.snapshots[this.index];
    const win = this.selectedWindow;
    if (!win) return;

    this.loading = true;
    try {
      const nodes = await queryNodesAt(
        this.trace.engine,
        win.windowId,
        snap.ts,
      );
      if (token !== this.loadToken) return;

      this.nodes = nodes;
      this.byRowId = new Map(nodes.map((n) => [n.rowId, n]));
      this.byNodeId = new Map(nodes.map((n) => [n.nodeId, n]));

      // Preserve selected node if still present in this snapshot
      let targetNodeId = this.selectedNodeId;
      if (targetNodeId === undefined || !this.byNodeId.has(targetNodeId)) {
        // Find default visible node
        const def = nodes.find((n) => n.isVisible) ?? nodes[0];
        targetNodeId = def?.nodeId;
      }

      if (targetNodeId !== undefined) {
        await this.selectNode(targetNodeId);
      } else {
        this.selectedNodeId = undefined;
        this.nodeVersions = [];
        this.nodeVersionChanges = [];
      }
    } finally {
      if (token === this.loadToken) {
        this.loading = false;
      }
    }
    m.redraw();
  }

  async selectNode(nodeId: string): Promise<void> {
    const token = ++this.nodeToken;
    this.selectedNodeId = nodeId;
    const win = this.selectedWindow;
    if (!win) return;

    const versions = await queryNodeVersions(
      this.trace.engine,
      win.windowId,
      nodeId,
    );
    if (token !== this.nodeToken) return;

    this.nodeVersions = versions;
    this.nodeVersionChanges = computeVersionDiffs(versions);
    m.redraw();
  }

  async prevSnapshot(): Promise<void> {
    if (this.index > 0) {
      await this.setIndex(this.index - 1);
    }
  }

  async nextSnapshot(): Promise<void> {
    if (this.index < this.snapshots.length - 1) {
      await this.setIndex(this.index + 1);
    }
  }
}
