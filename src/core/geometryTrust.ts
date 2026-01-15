/**
 * Geometry Trust Verification
 * Validates IOP/IPP/PixelSpacing consistency across series
 */

import type { Series, GeometryTrust, GeometryTrustInfo } from './types';

const EPSILON = 0.0001;

/**
 * Parse a DICOM multi-value string to number array
 */
function parseMultiValue(str?: string): number[] | null {
    if (!str) return null;
    const parts = str.split('\\').map(s => parseFloat(s.trim()));
    if (parts.some(isNaN)) return null;
    return parts;
}

/**
 * Check if two vectors are approximately equal
 */
function vectorsEqual(a: number[], b: number[], epsilon = EPSILON): boolean {
    if (a.length !== b.length) return false;
    return a.every((v, i) => Math.abs(v - b[i]) < epsilon);
}

/**
 * Verify geometry trust for a series
 */
export function verifySeriesGeometry(series: Series): GeometryTrustInfo {
    const reasons: string[] = [];
    const instances = series.instances;

    if (instances.length === 0) {
        return { level: 'unknown', reasons: ['No instances'] };
    }

    if (instances.length === 1) {
        const inst = instances[0];
        if (inst.imageOrientationPatient && inst.imagePositionPatient && inst.pixelSpacing) {
            return { level: 'verified', reasons: ['Single image with complete geometry'] };
        }
        if (inst.imageOrientationPatient || inst.imagePositionPatient) {
            return { level: 'trusted', reasons: ['Single image with partial geometry'] };
        }
        return { level: 'unknown', reasons: ['No geometry tags'] };
    }

    // Multiple instances - check consistency
    let hasIOP = false;
    let hasIPP = false;
    let hasSpacing = false;
    let iopConsistent = true;
    let spacingConsistent = true;
    let positionsValid = true;

    const refIOP = parseMultiValue(instances[0].imageOrientationPatient);
    const refSpacing = parseMultiValue(instances[0].pixelSpacing);

    if (refIOP && refIOP.length === 6) hasIOP = true;
    if (refSpacing && refSpacing.length === 2) hasSpacing = true;

    // Collect positions for stack analysis
    const positions: { pos: number[] }[] = [];

    for (const inst of instances) {
        const iop = parseMultiValue(inst.imageOrientationPatient);
        const spacing = parseMultiValue(inst.pixelSpacing);
        const ipp = parseMultiValue(inst.imagePositionPatient);

        if (ipp && ipp.length === 3) {
            hasIPP = true;
            positions.push({ pos: ipp });
        }

        // Check IOP consistency
        if (refIOP && iop) {
            if (!vectorsEqual(refIOP, iop)) {
                iopConsistent = false;
                reasons.push('Inconsistent orientation');
            }
        }

        // Check spacing consistency
        if (refSpacing && spacing) {
            if (!vectorsEqual(refSpacing, spacing, 0.001)) {
                spacingConsistent = false;
                reasons.push('Inconsistent pixel spacing');
            }
        }
    }

    // Check position regularity (equal spacing between slices)
    if (hasIOP && hasIPP && positions.length > 2) {
        // Calculate slice direction from IOP
        if (refIOP && refIOP.length === 6) {
            const rowDir = refIOP.slice(0, 3);
            const colDir = refIOP.slice(3, 6);
            const sliceDir = [
                rowDir[1] * colDir[2] - rowDir[2] * colDir[1],
                rowDir[2] * colDir[0] - rowDir[0] * colDir[2],
                rowDir[0] * colDir[1] - rowDir[1] * colDir[0],
            ];

            // Project positions onto slice direction
            const projections = positions.map(p => ({
                proj: p.pos[0] * sliceDir[0] + p.pos[1] * sliceDir[1] + p.pos[2] * sliceDir[2],
            }));

            // Sort by projection
            projections.sort((a, b) => a.proj - b.proj);

            // Check spacing regularity
            if (projections.length > 2) {
                const gaps: number[] = [];

                for (let i = 1; i < projections.length; i++) {
                    gaps.push(projections[i].proj - projections[i - 1].proj);
                }

                const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
                const maxDev = Math.max(...gaps.map(g => Math.abs(g - avgGap)));

                if (maxDev > Math.abs(avgGap) * 0.1) {
                    positionsValid = false;
                    reasons.push('Non-uniform slice spacing');
                }

                // Check for missing slices or duplicates
                if (gaps.some(g => Math.abs(g) < EPSILON)) {
                    reasons.push('Duplicate slice positions');
                }
            }
        }
    }

    // Determine trust level
    if (!hasIOP && !hasIPP) {
        return { level: 'unknown', reasons: ['No geometry information'] };
    }

    if (!iopConsistent) {
        return { level: 'untrusted', reasons };
    }

    if (!spacingConsistent) {
        reasons.push('Using assumed spacing values');
        return { level: 'trusted', reasons };
    }

    if (!positionsValid) {
        return { level: 'untrusted', reasons };
    }

    if (hasIOP && hasIPP && hasSpacing && iopConsistent && spacingConsistent && positionsValid) {
        if (reasons.length === 0) {
            return { level: 'verified', reasons: ['Geometry verified'] };
        }
    }

    if (hasIOP && hasSpacing) {
        return { level: 'trusted', reasons: reasons.length > 0 ? reasons : ['Partial geometry'] };
    }

    return { level: 'trusted', reasons: ['Limited geometry data'] };
}

/**
 * Get emoji badge for trust level
 */
export function getTrustBadge(level: GeometryTrust): string {
    switch (level) {
        case 'verified': return '🟢';
        case 'trusted': return '🟡';
        case 'untrusted': return '🔴';
        default: return '⚪';
    }
}

/**
 * Get human-readable description for trust level
 */
export function getTrustDescription(level: GeometryTrust): string {
    switch (level) {
        case 'verified': return 'Geometry verified';
        case 'trusted': return 'Geometry with assumptions';
        case 'untrusted': return 'Inconsistent geometry';
        default: return 'Unknown geometry';
    }
}
