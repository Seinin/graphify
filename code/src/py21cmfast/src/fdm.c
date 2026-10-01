/*
    fdm.c -- Fuzzy Dark Matter (FDM) physics module
    =================================================

    Contains FDM-specific physics: transfer function, HMF suppression factor,
    and CDM-reference sigma tables.

    References:
    - Hu, Barkana & Gruzinov (2000), PRL 85, 1158
    - Schive et al. (2016), PRL 116, 201302
*/

#include "fdm.h"

#include <gsl/gsl_errno.h>
#include <gsl/gsl_integration.h>
#include <math.h>
#include <stdio.h>

#include "Constants.h"
#include "InputParameters.h"
#include "cexcept.h"
#include "cosmology.h"
#include "exceptions.h"
#include "filtering.h"
#include "logger.h"

/* ---------------------------------------------------------------------------
 * FDM Transfer Function  --  T_F(k)
 * ---------------------------------------------------------------------------
 * Applies the FDM cutoff to the CDM power spectrum.
 * Reference: Hu, Barkana & Gruzinov (2000), Eq. (8)-(9).
 * ---------------------------------------------------------------------------
 */
double T_F(double k) {
    double T_fdm, x_fdm, kj_fdm;
    kj_fdm = 9. * pow(cosmo_params_global->m22, 1. / 2);
    x_fdm = 1.61 * pow(cosmo_params_global->m22, 1. / 18) * k / kj_fdm;
    T_fdm = cos(pow(x_fdm, 3.)) / (1 + pow(x_fdm, 8.));
    return T_fdm;
}

/* ---------------------------------------------------------------------------
 * FDM HMF Suppression Factor  --  dndm_FDM(M)
 * ---------------------------------------------------------------------------
 * Multiplicative suppression factor for the halo mass function in FDM
 * cosmologies.  Applies the LOW-MASS suppression due to quantum pressure
 * (NOTE: the Schive+16 fit index HMF_FINDEX is negative (-1.1), so halos
 *  with M << M0 are suppressed, NOT high-mass halos. An earlier version of
 *  this comment incorrectly said "high-mass cutoff".)
 * Reference: Schive et al. (2016), Eq. (7); Liu et al. (2025), Eq. (3).
 * ---------------------------------------------------------------------------
 */
double dndm_FDM(double M) {
    double H, M0;
    M0 = 1.6 * pow(10, 10) * pow(cosmo_params_global->m22, -4. / 3);
    H = pow((1 + pow(M / M0, matter_options_global->HMF_FINDEX)), -2.2);
    return H;
}

/* ---------------------------------------------------------------------------
 * CDM-reference dsigma/dk integrand (no FDM suppression)
 * ---------------------------------------------------------------------------
 * Same as dsigma_dk() in cosmology.c but always calls power_in_k_cdm()
 * instead of power_in_k(), so the FDM T_F cutoff is never applied.
 * ---------------------------------------------------------------------------
 */
struct SigmaIntegralParams {
    double radius;
    int filter_type;
};

static double dsigma_dk_pre(double k, void *params) {
    double p, w, kR;

    struct SigmaIntegralParams *pars = (struct SigmaIntegralParams *)params;
    double Radius = pars->radius;
    int filter = pars->filter_type;

    kR = k * Radius;
    w = filter_function(kR, filter);
    p = power_in_k_cdm(k);

    return k * k * p * w * w / (2.0 * M_PI * M_PI);
}

/* ---------------------------------------------------------------------------
 * CDM-reference sigma(M) at z=0  --  sigma_z0_pre(M)
 * ---------------------------------------------------------------------------
 * Computes sigma(M) using the CDM power spectrum *without* the FDM
 * transfer function cutoff.  This is needed when running in FDM mode
 * to provide a CDM reference for the halo mass function.
 * ---------------------------------------------------------------------------
 */
double sigma_z0_pre(double M) {
    double result, error, lower_limit, upper_limit;
    gsl_function F;
    double rel_tol = FRACT_FLOAT_ERR * 10;
    gsl_integration_workspace *w = gsl_integration_workspace_alloc(1000);

    double Radius = MtoR(M);

    lower_limit = 1.0e-99 / Radius;
    upper_limit = 350.0 / Radius;

    struct SigmaIntegralParams sigma_params = {.radius = Radius,
                                               .filter_type = matter_options_global->FILTER};
    F.function = &dsigma_dk_pre;
    F.params = &sigma_params;

    int status;

    gsl_set_error_handler_off();

    status = gsl_integration_qag(&F, lower_limit, upper_limit, 0, rel_tol, 1000, GSL_INTEG_GAUSS61,
                                 w, &result, &error);

    if (status != 0) {
        LOG_ERROR("gsl integration error occured in sigma_z0_pre!");
        LOG_ERROR(
            "(function argument): lower_limit=%e upper_limit=%e rel_tol=%e result=%e error=%e",
            lower_limit, upper_limit, rel_tol, result, error);
        LOG_ERROR("data: M=%e", M);
        CATCH_GSL_ERROR(status);
    }

    gsl_integration_workspace_free(w);

    return sqrt(result);
}

/* ---------------------------------------------------------------------------
 * CDM-reference dsigmasq/dm integrand (no FDM suppression)
 * ---------------------------------------------------------------------------
 */
static double dsigmasq_dm_pre(double k, void *params) {
    struct SigmaIntegralParams *pars = (struct SigmaIntegralParams *)params;
    double Radius = pars->radius;
    int filter = pars->filter_type;

    double dw2dm = dwdm_filter(k, Radius, filter);
    double p = power_in_k_cdm(k);

    return k * k * p * dw2dm / (2.0 * M_PI * M_PI);
}

/* ---------------------------------------------------------------------------
 * CDM-reference dsigma^2/dM at z=0  --  dsigmasqdm_z0_pre(M)
 * ---------------------------------------------------------------------------
 * Returns d/dM (sigma^2) using CDM power spectrum only (no FDM T_F).
 * ---------------------------------------------------------------------------
 */
double dsigmasqdm_z0_pre(double M) {
    double result, error, lower_limit, upper_limit;
    gsl_function F;
    double rel_tol = FRACT_FLOAT_ERR * 10;
    gsl_integration_workspace *w = gsl_integration_workspace_alloc(1000);

    double Radius = MtoR(M);

    lower_limit = 1.0e-99 / Radius;
    upper_limit = 350.0 / Radius;

    struct SigmaIntegralParams sigma_params = {.radius = Radius,
                                               .filter_type = matter_options_global->FILTER};
    F.function = &dsigmasq_dm_pre;
    F.params = &sigma_params;

    int status;

    gsl_set_error_handler_off();

    status = gsl_integration_qag(&F, lower_limit, upper_limit, 0, rel_tol, 1000, GSL_INTEG_GAUSS61,
                                 w, &result, &error);

    if (status != 0) {
        LOG_ERROR("gsl integration error occured in dsigmasqdm_z0_pre!");
        LOG_ERROR(
            "(function argument): lower_limit=%e upper_limit=%e rel_tol=%e result=%e error=%e",
            lower_limit, upper_limit, rel_tol, result, error);
        LOG_ERROR("data: M=%e", M);
        CATCH_GSL_ERROR(status);
    }

    gsl_integration_workspace_free(w);

    return result;
}
