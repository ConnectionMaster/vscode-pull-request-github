/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Inspired by and includes code from GitHub/VisualStudio project, obtained from  https://github.com/github/VisualStudio/blob/master/src/GitHub.Exports/Models/DiffLine.cs
 */

import { GitChangeType, SlimFileChange, InMemFileChange } from './file';
import { Repository } from './repository';
import { Comment } from './comment';


export enum DiffChangeType {
	Context,
	Add,
	Delete,
	Control
}

export class DiffLine {
	public get raw(): string {
		return this._raw;
	}

	public get text(): string {
		return this._raw.substr(1);
	}

	constructor(
		public type: DiffChangeType,
		public oldLineNumber: number, /* 1 based */
		public newLineNumber: number, /* 1 based */
		public positionInHunk: number,
		private _raw: string,
		public endwithLineBreak: boolean = true
	) { }
}

export function getDiffChangeType(text: string) {
	let c = text[0];
	switch (c) {
		case ' ': return DiffChangeType.Context;
		case '+': return DiffChangeType.Add;
		case '-': return DiffChangeType.Delete;
		default: return DiffChangeType.Control;
	}
}

export class DiffHunk {
	public diffLines: DiffLine[] = [];

	constructor(
		public oldLineNumber: number,
		public oldLength: number,
		public newLineNumber: number,
		public newLength: number,
		public positionInHunk: number
	) { }
}

export const DIFF_HUNK_HEADER = /@@ \-(\d+)(,(\d+))?( \+(\d+)(,(\d+)?)?)? @@/;

export function countCarriageReturns(text: string): number {
	let count = 0;
	let index = 0;
	while ((index = text.indexOf('\r', index)) !== -1) {
		index++;
		count++;
	}

	return count;
}

export function* LineReader(text: string): IterableIterator<string> {
	let index = 0;

	while (index !== -1 && index < text.length) {
		let startIndex = index;
		index = text.indexOf('\n', index);
		let endIndex = index !== -1 ? index : text.length;
		let length = endIndex - startIndex;

		if (index !== -1) {
			if (index > 0 && text[index - 1] === '\r') {
				length--;
			}

			index++;
		}

		yield text.substr(startIndex, length);
	}
}

export function* parseDiffHunk(diffHunkPatch: string): IterableIterator<DiffHunk> {
	let lineReader = LineReader(diffHunkPatch);

	let itr = lineReader.next();
	let diffHunk: DiffHunk = null;
	let positionInHunk = -1;
	let oldLine = -1;
	let newLine = -1;

	while (!itr.done) {
		const line = itr.value;
		if (DIFF_HUNK_HEADER.test(line)) {
			if (diffHunk) {
				yield diffHunk;
				diffHunk = null;
			}

			if (positionInHunk === -1) {
				positionInHunk = 0;
			}

			const matches = DIFF_HUNK_HEADER.exec(line);
			const oriStartLine = oldLine = Number(matches[1]);
			const oriLen = Number(matches[3]) | 0;
			const newStartLine = newLine = Number(matches[5]);
			const newLen = Number(matches[7]) | 0;

			diffHunk = new DiffHunk(oriStartLine, oriLen, newStartLine, newLen, positionInHunk);
			// @rebornix todo, once we have enough tests, this should be removed.
			diffHunk.diffLines.push(new DiffLine(DiffChangeType.Control, -1, -1, positionInHunk, line));
		} else if (diffHunk !== null) {
			let type = getDiffChangeType(line);

			if (type === DiffChangeType.Control) {
				if (diffHunk.diffLines && diffHunk.diffLines.length) {
					diffHunk.diffLines[diffHunk.diffLines.length - 1].endwithLineBreak = false;
				}
			} else {
				diffHunk.diffLines.push(new DiffLine(type, type !== DiffChangeType.Add ? oldLine : -1,
					type !== DiffChangeType.Delete ? newLine : -1,
					positionInHunk,
					line
				));

				let lineCount = 1 + countCarriageReturns(line);

				switch (type) {
					case DiffChangeType.Context:
						oldLine += lineCount;
						newLine += lineCount;
						break;
					case DiffChangeType.Delete:
						oldLine += lineCount;
						break;
					case DiffChangeType.Add:
						newLine += lineCount;
						break;
				}
			}
		}

		if (positionInHunk !== -1) {
			++positionInHunk;
		}
		itr = lineReader.next();
	}

	if (diffHunk) {
		yield diffHunk;
	}
}

export function parsePatch(patch: string): DiffHunk[] {
	let diffHunkReader = parseDiffHunk(patch);
	let diffHunkIter = diffHunkReader.next();
	let diffHunks = [];

	let right = [];
	while (!diffHunkIter.done) {
		let diffHunk = diffHunkIter.value;
		diffHunks.push(diffHunk);

		for (let j = 0; j < diffHunk.diffLines.length; j++) {
			let diffLine = diffHunk.diffLines[j];
			if (diffLine.type === DiffChangeType.Delete || diffLine.type === DiffChangeType.Control) {
			} else if (diffLine.type === DiffChangeType.Add) {
				right.push(diffLine.text);
			} else {
				let codeInFirstLine = diffLine.text;
				right.push(codeInFirstLine);
			}
		}

		diffHunkIter = diffHunkReader.next();
	}

	return diffHunks;
}

export function getModifiedContentFromDiffHunk(originalContent, patch) {
	let left = originalContent.split(/\r?\n/);
	let diffHunkReader = parseDiffHunk(patch);
	let diffHunkIter = diffHunkReader.next();
	let diffHunks = [];

	let right = [];
	let lastCommonLine = 0;
	while (!diffHunkIter.done) {
		let diffHunk = diffHunkIter.value;
		diffHunks.push(diffHunk);

		let oriStartLine = diffHunk.oldLineNumber;

		for (let j = lastCommonLine + 1; j < oriStartLine; j++) {
			right.push(left[j - 1]);
		}

		lastCommonLine = oriStartLine + diffHunk.oldLength - 1;

		for (let j = 0; j < diffHunk.diffLines.length; j++) {
			let diffLine = diffHunk.diffLines[j];
			if (diffLine.type === DiffChangeType.Delete || diffLine.type === DiffChangeType.Control) {
			} else if (diffLine.type === DiffChangeType.Add) {
				right.push(diffLine.text);
			} else {
				let codeInFirstLine = diffLine.text;
				right.push(codeInFirstLine);
			}
		}

		diffHunkIter = diffHunkReader.next();
	}

	if (lastCommonLine < left.length) {
		for (let j = lastCommonLine + 1; j <= left.length; j++) {
			right.push(left[j - 1]);
		}
	}

	return right.join('\n');
}

export function getGitChangeType(status: string): GitChangeType {
	switch (status) {
		case 'removed':
			return GitChangeType.DELETE;
		case 'added':
			return GitChangeType.ADD;
		case 'renamed':
			return GitChangeType.RENAME;
		case 'modified':
			return GitChangeType.MODIFY;
		default:
			return GitChangeType.UNKNOWN
	}
}

export async function parseDiff(reviews: any[], repository: Repository, parentCommit: string): Promise<(InMemFileChange | SlimFileChange)[]> {
	let fileChanges: (InMemFileChange | SlimFileChange)[] = [];

	for (let i = 0; i < reviews.length; i++) {
		let review = reviews[i];

		if (!review.patch) {
			const gitChangeType = getGitChangeType(review.status);
			fileChanges.push(new SlimFileChange(review.blob_url, gitChangeType, review.filename));
			continue;
		}

		const gitChangeType = getGitChangeType(review.status);

		let originalFileExist = await repository.checkFileExistence(parentCommit, review.filename);
		let diffHunks = parsePatch(review.patch);
		let isPartial = !originalFileExist && gitChangeType !== GitChangeType.ADD;
		fileChanges.push(new InMemFileChange(parentCommit, gitChangeType, review.filename, review.patch, diffHunks, isPartial, review.blob_url))
	}

	return fileChanges;
}

export function parserCommentDiffHunk(comments: any[]): Comment[] {
	for (let i = 0; i < comments.length; i++) {
		let diffHunks = [];
		let diffHunkReader = parseDiffHunk(comments[i].diff_hunk);
		let diffHunkIter = diffHunkReader.next();

		while (!diffHunkIter.done) {
			let diffHunk = diffHunkIter.value;
			diffHunks.push(diffHunk);
			diffHunkIter = diffHunkReader.next();
		}

		comments[i].diff_hunks = diffHunks;
	}

	return comments;
}