#ifndef _FDM_H
#define _FDM_H

/* FDM transfer function -- Hu, Barkana & Gruzinov (2000) */
double T_F(double k);

/* FDM HMF suppression factor -- Schive et al. (2016) */
double dndm_FDM(double M);

/* CDM-reference sigma(M) at z=0 (no FDM transfer function cutoff) */
double sigma_z0_pre(double M);

/* CDM-reference dsigma^2/dM at z=0 */
double dsigmasqdm_z0_pre(double M);

#endif
