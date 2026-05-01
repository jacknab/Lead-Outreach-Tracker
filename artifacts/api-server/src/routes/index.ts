import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import leadsRouter from "./leads";
import callsRouter from "./calls";
import campaignsRouter from "./campaigns";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(leadsRouter);
router.use(callsRouter);
router.use(campaignsRouter);
router.use(dashboardRouter);

export default router;
