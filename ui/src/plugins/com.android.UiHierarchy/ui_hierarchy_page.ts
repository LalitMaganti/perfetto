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
import {Select} from '../../widgets/select';
import {UiHierarchyViewer} from './ui_hierarchy_viewer';
import type {UiHierarchySession} from './ui_hierarchy_session';

export interface UiHierarchyPageAttrs {
  readonly session: UiHierarchySession;
  readonly subpage: string | undefined;
}

export class UiHierarchyPage implements m.ClassComponent<UiHierarchyPageAttrs> {
  oninit(vnode: m.Vnode<UiHierarchyPageAttrs>): void {
    this.syncSubpage(vnode);
  }

  onbeforeupdate(vnode: m.Vnode<UiHierarchyPageAttrs>): void {
    this.syncSubpage(vnode);
  }

  private syncSubpage(vnode: m.Vnode<UiHierarchyPageAttrs>): void {
    const subpage = vnode.attrs.subpage;
    if (!subpage) return;
    const s = vnode.attrs.session;
    const targetKey = decodeURIComponent(subpage);
    const targetWin = s.windows.find(
      (w) => w.key === targetKey || `${w.upid}` === targetKey,
    );
    if (targetWin && targetWin.key !== s.selectedWindowKey) {
      void s.setWindow(targetWin.key);
    }
  }

  view(vnode: m.Vnode<UiHierarchyPageAttrs>): m.Children {
    const s = vnode.attrs.session;

    if (s.windows.length === 0) {
      return m(
        '.pf-uih-page',
        m(
          '.pf-uih-empty',
          'No UI hierarchy data found in trace. Record with the ' +
            'android.ui.hierarchy data source.',
        ),
      );
    }

    const snap = s.currentSnapshot;
    const win = s.selectedWindow;

    return m('.pf-uih-page', [
      m('.pf-uih-bar', [
        s.processes.length > 1 &&
          m(
            Select,
            {
              title: 'Process selector',
              onchange: (e: Event) =>
                void s.setProcess(
                  Number((e.target as HTMLSelectElement).value),
                ),
            },
            s.processes.map((p) =>
              m(
                'option',
                {value: p.upid, selected: p.upid === s.selectedProcessUpid},
                `${p.processName ?? 'Process'} (PID ${p.pid !== undefined ? p.pid : '?'}, upid: ${p.upid})`,
              ),
            ),
          ),
        m(
          Select,
          {
            title: 'Window selector',
            onchange: (e: Event) =>
              void s.setWindow((e.target as HTMLSelectElement).value),
          },
          s.windowsForSelectedProcess.map((w) =>
            m(
              'option',
              {value: w.key, selected: w.key === s.selectedWindowKey},
              s.processes.length > 1
                ? w.title
                : `${w.processName ?? 'App'}: ${w.title}`,
            ),
          ),
        ),
        m(Button, {
          icon: 'timeline',
          label: 'Timeline',
          title: 'Jump to this snapshot in the timeline',
          onclick: () => {
            const cur = s.currentSnapshot;
            if (cur === undefined || win === undefined) return;
            s.trace.navigate('#!/viewer');
            s.trace.selection.selectTrackEvent(
              `/ui_hierarchy_track/${win.key}`,
              cur.snapshotId,
              {scrollToSelection: true},
            );
          },
        }),
        m(Button, {
          icon: 'first_page',
          title: 'First snapshot',
          onclick: () => void s.setIndex(0),
        }),
        m(Button, {
          icon: 'chevron_left',
          title: 'Previous snapshot',
          onclick: () => void s.prevSnapshot(),
        }),
        m('input.pf-uih-scrub[type=range]', {
          min: 0,
          max: Math.max(0, s.snapshots.length - 1),
          value: s.index,
          title: 'Scrub snapshots across time',
          oninput: (e: Event) =>
            void s.setIndex(Number((e.target as HTMLInputElement).value)),
        }),
        m(Button, {
          icon: 'chevron_right',
          title: 'Next snapshot',
          onclick: () => void s.nextSnapshot(),
        }),
        m(Button, {
          icon: 'last_page',
          title: 'Last snapshot',
          onclick: () => void s.setIndex(s.snapshots.length - 1),
        }),
        m(
          'span.pf-uih-bar__pos',
          `${s.snapshots.length === 0 ? 0 : s.index + 1} / ${s.snapshots.length}`,
        ),
        snap !== undefined &&
          m('span.pf-uih-bar__badge', [
            snap.isKeyframe
              ? m('span.pf-uih-keyframe-badge', 'KEYFRAME')
              : m(
                  'span.pf-uih-delta-badge',
                  `Δ (+${snap.changedNodeCount} -${snap.removedNodeCount})`,
                ),
          ]),
        snap !== undefined &&
          m('span.pf-uih-bar__ts', [
            m(Timestamp, {trace: s.trace, ts: Time.fromRaw(snap.ts)}),
          ]),
      ]),
      m(
        '.pf-uih-main',
        s.snapshots.length === 0
          ? m('.pf-uih-empty', 'No snapshots recorded for this window.')
          : m(UiHierarchyViewer, {session: s}),
      ),
    ]);
  }
}
