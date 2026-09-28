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

import './ui_hierarchy.scss';
import m from 'mithril';
import {Time} from '../../base/time';
import {Timestamp} from '../../components/widgets/timestamp';
import {Button} from '../../widgets/button';
import {Chip} from '../../widgets/chip';
import {Intent} from '../../widgets/common';
import {Section} from '../../widgets/section';
import {TextInput} from '../../widgets/text_input';
import {renderUiHierarchyControls} from './ui_hierarchy_controls';
import {kindToString, type UiHierarchyNode} from './ui_hierarchy_data';
import {UiHierarchyRectsView} from './ui_hierarchy_rects';
import type {UiHierarchySession} from './ui_hierarchy_session';

export interface UiHierarchyViewerAttrs {
  readonly session: UiHierarchySession;
}

interface HierarchyTreeItem {
  readonly node: UiHierarchyNode;
  readonly children: HierarchyTreeItem[];
}

export class UiHierarchyViewer implements m.ClassComponent<UiHierarchyViewerAttrs> {
  view(vnode: m.Vnode<UiHierarchyViewerAttrs>): m.Children {
    const s = vnode.attrs.session;
    return m('.pf-uih-viewer', [
      this.renderRectsPane(s),
      this.renderHierarchyPane(s),
      this.renderPropertiesPane(s),
    ]);
  }

  // -------------------------------------------------------------
  // Pane 1: Rects (2D/3D Canvas)
  // -------------------------------------------------------------
  private renderRectsPane(s: UiHierarchySession): m.Children {
    const o = s.options;
    return m('.pf-uih-pane.pf-uih-pane--rects', [
      m(Section, {title: 'Surface Layout'}, [
        renderUiHierarchyControls(o),
        m(
          '.pf-uih-canvas-container',
          {
            style:
              'position:relative; width:100%; height:520px; min-height:400px;',
          },
          m(UiHierarchyRectsView, {
            session: s,
            nodes: this.filterNodes(s),
            selectedNodeId: s.selectedNodeId,
            onSelect: (nodeId) => void s.selectNode(nodeId),
            options: o,
          }),
        ),
      ]),
    ]);
  }

  // -------------------------------------------------------------
  // Pane 2: Hierarchy Tree
  // -------------------------------------------------------------
  private renderHierarchyPane(s: UiHierarchySession): m.Children {
    const o = s.options;
    const tree = this.buildTree(s);

    return m('.pf-uih-pane.pf-uih-pane--hierarchy', [
      m(Section, {title: 'Node Hierarchy'}, [
        m('.pf-uih-hier-controls', [
          m(TextInput, {
            placeholder: 'Search nodes by name, id, text, tag...',
            value: o.searchQuery,
            oninput: (e: Event) => {
              o.searchQuery = (e.target as HTMLInputElement).value;
              m.redraw();
            },
          }),
          m(
            '.pf-uih-chips-bar',
            {style: 'display:flex; gap:4px; margin-top:6px; flex-wrap:wrap;'},
            [
              m(Chip, {
                label: 'All',
                intent:
                  o.kindFilter === undefined ? Intent.Primary : Intent.None,
                compact: true,
                onclick: () => {
                  o.kindFilter = undefined;
                  m.redraw();
                },
              }),
              m(Chip, {
                label: 'View',
                intent: o.kindFilter === 1 ? Intent.Primary : Intent.None,
                compact: true,
                onclick: () => {
                  o.kindFilter = o.kindFilter === 1 ? undefined : 1;
                  m.redraw();
                },
              }),
              m(Chip, {
                label: 'ComposeView',
                intent: o.kindFilter === 2 ? Intent.Primary : Intent.None,
                compact: true,
                onclick: () => {
                  o.kindFilter = o.kindFilter === 2 ? undefined : 2;
                  m.redraw();
                },
              }),
              m(Chip, {
                label: 'ComposeNode',
                intent: o.kindFilter === 3 ? Intent.Primary : Intent.None,
                compact: true,
                onclick: () => {
                  o.kindFilter = o.kindFilter === 3 ? undefined : 3;
                  m.redraw();
                },
              }),
              m(Chip, {
                label: 'Composable',
                intent: o.kindFilter === 4 ? Intent.Primary : Intent.None,
                compact: true,
                onclick: () => {
                  o.kindFilter = o.kindFilter === 4 ? undefined : 4;
                  m.redraw();
                },
              }),
            ],
          ),
        ]),
        m(
          '.pf-uih-tree-view',
          {
            style:
              'margin-top:8px; overflow-y:auto; max-height:calc(100vh - 180px);',
          },
          tree.length === 0
            ? m('.pf-uih-muted', 'No matching nodes in this snapshot.')
            : tree.map((item) => this.renderTreeItem(s, item, 0)),
        ),
      ]),
    ]);
  }

  private filterNodes(s: UiHierarchySession): UiHierarchyNode[] {
    let pool = s.nodes;
    if (s.options.onlyVisible) {
      pool = pool.filter((n) => n.isVisible);
    }
    if (s.options.onlyClickable) {
      pool = pool.filter((n) => n.isClickable);
    }
    if (s.options.kindFilter !== undefined) {
      pool = pool.filter((n) => n.kind === s.options.kindFilter);
    }
    return pool;
  }

  private buildTree(s: UiHierarchySession): HierarchyTreeItem[] {
    const o = s.options;
    let pool = s.nodes;

    if (o.onlyVisible) {
      pool = pool.filter((n) => n.isVisible);
    }
    if (o.onlyClickable) {
      pool = pool.filter((n) => n.isClickable);
    }
    if (o.kindFilter !== undefined) {
      pool = pool.filter((n) => n.kind === o.kindFilter);
    }

    if (o.searchQuery.trim()) {
      const q = o.searchQuery.toLowerCase();
      const matchedNodeIds = new Set<string>();
      for (const n of s.nodes) {
        const matches =
          n.name.toLowerCase().includes(q) ||
          String(n.nodeId).includes(q) ||
          Boolean(n.text?.toLowerCase().includes(q)) ||
          Boolean(n.testTag?.toLowerCase().includes(q)) ||
          Boolean(n.contentDescription?.toLowerCase().includes(q)) ||
          Boolean(n.sourceLocation?.toLowerCase().includes(q));
        if (matches) {
          let cur: UiHierarchyNode | undefined = n;
          while (cur && !matchedNodeIds.has(cur.nodeId)) {
            matchedNodeIds.add(cur.nodeId);
            cur =
              cur.parentNodeId !== undefined
                ? s.byNodeId.get(cur.parentNodeId)
                : undefined;
          }
        }
      }
      pool = pool.filter((n) => matchedNodeIds.has(n.nodeId));
    }

    const inPool = new Set(pool.map((n) => n.nodeId));
    const childrenOf = new Map<string, UiHierarchyNode[]>();
    const roots: UiHierarchyNode[] = [];

    for (const node of pool) {
      if (node.parentNodeId !== undefined && inPool.has(node.parentNodeId)) {
        const arr = childrenOf.get(node.parentNodeId);
        if (arr) arr.push(node);
        else childrenOf.set(node.parentNodeId, [node]);
      } else {
        roots.push(node);
      }
    }

    const visited = new Set<string>();
    const build = (node: UiHierarchyNode): HierarchyTreeItem => {
      if (visited.has(node.nodeId)) {
        return {node, children: []};
      }
      visited.add(node.nodeId);
      return {
        node,
        children: (childrenOf.get(node.nodeId) ?? []).map(build),
      };
    };

    return roots.map(build);
  }

  private renderTreeItem(
    s: UiHierarchySession,
    item: HierarchyTreeItem,
    depth: number,
  ): m.Children {
    const n = item.node;
    const isSelected = s.selectedNodeId === n.nodeId;

    return m('.pf-uih-tree-node-wrap', [
      m(
        '.pf-uih-tree-row',
        {
          class: isSelected ? 'pf-uih-tree-row--selected' : '',
          style: `padding-left: ${depth * 14 + 6}px; display:flex; align-items:center; gap:6px; height:24px; cursor:pointer; font-size:12px;`,
          onclick: () => void s.selectNode(n.nodeId),
        },
        [
          m(Chip, {
            label: kindToString(n.kind),
            intent: this.intentForKind(n.kind),
            compact: true,
            title: `Kind: ${kindToString(n.kind)}`,
          }),
          m(
            'span.pf-uih-node-name',
            {
              style: isSelected
                ? 'font-weight:bold; color:var(--pf-color-accent);'
                : '',
              title: `${n.name} (id=${n.nodeId})`,
            },
            n.name || `Node ${n.nodeId}`,
          ),
          n.isTextRedacted &&
            m(Chip, {
              label: 'Redacted',
              intent: Intent.Danger,
              compact: true,
              title: 'Sensitive password field redacted',
            }),
          n.text &&
            !n.isTextRedacted &&
            m(
              'span.pf-uih-text-preview',
              {
                style:
                  'color:var(--pf-color-text-muted); font-size:11px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;',
              },
              `"${n.text}"`,
            ),
          n.testTag &&
            m(
              'span.pf-uih-tag-preview',
              {
                style:
                  'color:var(--pf-color-accent); font-size:10px; background:rgba(0,0,0,0.06); padding:1px 3px; border-radius:2px;',
              },
              `#${n.testTag}`,
            ),
          !n.isVisible &&
            m(
              'span.pf-uih-hidden-icon',
              {
                title: 'Hidden / Not visible',
                style:
                  'color:var(--pf-color-text-muted); font-size:11px; margin-left:auto;',
              },
              '👁️‍🗨️',
            ),
        ],
      ),
      item.children.length > 0 &&
        item.children.map((child) => this.renderTreeItem(s, child, depth + 1)),
    ]);
  }

  private intentForKind(kind: number): Intent {
    switch (kind) {
      case 1:
        return Intent.Primary; // View
      case 2:
        return Intent.Warning; // ComposeView
      case 3:
        return Intent.Success; // ComposeNode
      case 4:
        return Intent.None; // Composable
      default:
        return Intent.None;
    }
  }

  // -------------------------------------------------------------
  // Pane 3: Properties + Change History
  // -------------------------------------------------------------
  private renderPropertiesPane(s: UiHierarchySession): m.Children {
    const node = s.selectedNode;
    if (!node) {
      return m('.pf-uih-pane.pf-uih-pane--props', [
        m(Section, {title: 'Node Properties'}, [
          m(
            '.pf-uih-muted',
            'Select a node from the surface or hierarchy tree to inspect properties.',
          ),
        ]),
      ]);
    }

    const w = node.boundsRight - node.boundsLeft;
    const h = node.boundsBottom - node.boundsTop;

    return m('.pf-uih-pane.pf-uih-pane--props', [
      m(Section, {title: `Node Properties (#${node.nodeId})`}, [
        // Node Header Card
        m('.pf-uih-card', [
          m(
            '.pf-uih-card__title',
            {style: 'font-weight:bold; font-size:14px;'},
            node.name,
          ),
          m(
            '.pf-uih-card__subtitle',
            {
              style:
                'color:var(--pf-color-text-muted); font-size:12px; margin-top:2px;',
            },
            [
              `Kind: ${node.kindName} • ID: ${node.nodeId} • Window: ${node.windowId}`,
            ],
          ),
          node.isTextRedacted &&
            m(
              '.pf-uih-redacted-badge',
              {
                style:
                  'margin-top:8px; padding:6px 10px; background:rgba(244,67,54,0.15); border:1px solid #f44336; border-radius:4px; color:#d32f2f; font-weight:bold; font-size:11px; display:flex; align-items:center; gap:6px;',
              },
              [
                m('span', '🔒'),
                m(
                  'span',
                  'PASSWORD / SENSITIVE FIELD - REDACTED (flag 131072)',
                ),
              ],
            ),
        ]),

        // Basic & Layout Properties
        m('.pf-uih-props-table-wrap', {style: 'margin-top:12px;'}, [
          m('table.pf-uih-props-table', [
            m('tbody', [
              m('tr', [
                m('td.pf-uih-prop-key', 'Bounds'),
                m(
                  'td.pf-uih-prop-val',
                  `[${node.boundsLeft}, ${node.boundsTop}, ${node.boundsRight}, ${node.boundsBottom}] (${w} × ${h} px)`,
                ),
              ]),
              node.sourceLocation &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Source Location'),
                  m('td.pf-uih-prop-val', node.sourceLocation),
                ]),
              m('tr', [
                m('td.pf-uih-prop-key', 'Flags'),
                m(
                  'td.pf-uih-prop-val',
                  `0x${node.flags.toString(16)} (visible: ${node.isVisible}, clickable: ${node.isClickable}, focused: ${node.isFocused})`,
                ),
              ]),
              m('tr', [
                m('td.pf-uih-prop-key', 'Alpha / Elevation'),
                m(
                  'td.pf-uih-prop-val',
                  `Alpha: ${node.alpha} • Elevation: ${node.elevation ?? 0} dp`,
                ),
              ]),
              node.text !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Text'),
                  m(
                    'td.pf-uih-prop-val',
                    node.isTextRedacted
                      ? m('em', '<redacted password>')
                      : `"${node.text}"`,
                  ),
                ]),
              node.contentDescription !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Content Description'),
                  m('td.pf-uih-prop-val', `"${node.contentDescription}"`),
                ]),
              node.testTag !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Test Tag'),
                  m('td.pf-uih-prop-val', node.testTag),
                ]),
              node.role !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Role / Semantics'),
                  m('td.pf-uih-prop-val', node.role),
                ]),
              node.stateDescription !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'State Description'),
                  m('td.pf-uih-prop-val', node.stateDescription),
                ]),
              node.actions !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Actions'),
                  m('td.pf-uih-prop-val', node.actions),
                ]),
              (node.recompositionCount !== undefined ||
                node.skipCount !== undefined) &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Recomposition'),
                  m(
                    'td.pf-uih-prop-val',
                    `Recomposed: ${node.recompositionCount ?? 0} • Skipped: ${node.skipCount ?? 0}`,
                  ),
                ]),
              node.properties !== undefined &&
                m('tr', [
                  m('td.pf-uih-prop-key', 'Custom Properties'),
                  m('td.pf-uih-prop-val.pf-uih-code', node.properties),
                ]),
            ]),
          ]),
        ]),

        // Change View: Node Versions Over Time
        m(
          '.pf-uih-history-section',
          {
            style:
              'margin-top:20px; border-top: 1px solid var(--pf-color-border); padding-top:12px;',
          },
          [
            m(
              '.pf-uih-history-header',
              {
                style:
                  'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;',
              },
              [
                m(
                  'span',
                  {style: 'font-weight:bold; font-size:13px;'},
                  `Node Change History (${s.nodeVersions.length} versions)`,
                ),
              ],
            ),
            s.nodeVersionChanges.length === 0
              ? m('.pf-uih-muted', 'No versions recorded for this node.')
              : m(
                  '.pf-uih-history-list',
                  s.nodeVersionChanges.map((v) =>
                    m(
                      '.pf-uih-history-item',
                      {
                        style:
                          'padding:8px; margin-bottom:6px; background:var(--pf-color-background-secondary); border-radius:4px; border:1px solid var(--pf-color-border);',
                      },
                      [
                        m(
                          '.pf-uih-history-title',
                          {
                            style:
                              'display:flex; align-items:center; justify-content:space-between; font-size:12px;',
                          },
                          [
                            m(
                              'span',
                              {style: 'font-weight:bold;'},
                              `Version #${v.versionIndex + 1}`,
                            ),
                            m(
                              'span',
                              m(Timestamp, {
                                trace: s.trace,
                                ts: Time.fromRaw(v.ts),
                              }),
                            ),
                            m(Button, {
                              label: 'Jump',
                              compact: true,
                              onclick: () => void s.setNearestTs(v.ts),
                              title: 'Jump to this snapshot in viewer',
                            }),
                          ],
                        ),
                        m(
                          'ul.pf-uih-history-changes',
                          {
                            style:
                              'margin:4px 0 0 16px; padding:0; font-size:11px; color:var(--pf-color-text);',
                          },
                          v.changedProps.map((diff) => m('li', diff)),
                        ),
                      ],
                    ),
                  ),
                ),
          ],
        ),
      ]),
    ]);
  }
}
