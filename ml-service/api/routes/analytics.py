"""
Analytics endpoints for ML Service
Business Intelligence and Analytics API
"""

from fastapi import APIRouter, HTTPException, Depends, status, Query
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
import logging
from datetime import datetime, timedelta
import pandas as pd

from services.prediction_service import PredictionService
from config.database import get_collection, aggregate_pipeline
from config.settings import get_settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Pydantic models for analytics
class BusinessMetricsResponse(BaseModel):
    revenue_forecast: Dict[str, Any]
    payment_insights: Dict[str, Any]
    customer_analytics: Dict[str, Any]
    inventory_insights: Dict[str, Any]
    risk_summary: Dict[str, Any]

class CustomerInsightsResponse(BaseModel):
    customer_id: str
    customer_name: str
    risk_profile: Dict[str, Any]
    payment_behavior: Dict[str, Any]
    revenue_contribution: Dict[str, Any]
    recommendations: List[str]

class InventoryAnalyticsResponse(BaseModel):
    total_items: int
    low_stock_items: List[Dict[str, Any]]
    overstock_items: List[Dict[str, Any]]
    demand_trends: List[Dict[str, Any]]
    reorder_recommendations: List[Dict[str, Any]]

# Dependency
async def get_prediction_service() -> PredictionService:
    return PredictionService()

@router.get("/business-metrics", response_model=BusinessMetricsResponse)
async def get_business_metrics(
    days_back: int = Query(default=30, ge=1, le=365),
    prediction_service: PredictionService = Depends(get_prediction_service)
):
    """Get comprehensive business metrics and forecasts"""
    try:
        # Calculate date range
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        
        # Revenue forecast
        revenue_forecast = await _get_revenue_forecast(start_date, end_date)
        
        # Payment insights
        payment_insights = await _get_payment_insights(start_date, end_date)
        
        # Customer analytics
        customer_analytics = await _get_customer_analytics(start_date, end_date)
        
        # Inventory insights
        inventory_insights = await _get_inventory_insights()
        
        # Risk summary
        risk_summary = await _get_risk_summary()
        
        return BusinessMetricsResponse(
            revenue_forecast=revenue_forecast,
            payment_insights=payment_insights,
            customer_analytics=customer_analytics,
            inventory_insights=inventory_insights,
            risk_summary=risk_summary
        )
        
    except Exception as e:
        logger.error(f"Failed to get business metrics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve business metrics"
        )

@router.get("/customer-insights/{customer_id}", response_model=CustomerInsightsResponse)
async def get_customer_insights(
    customer_id: str,
    prediction_service: PredictionService = Depends(get_prediction_service)
):
    """Get detailed insights for a specific customer"""
    try:
        # Get customer data
        customers_collection = await get_collection("customers")
        customer = await customers_collection.find_one({"_id": customer_id})
        
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Customer not found"
            )
        
        # Risk assessment
        risk_assessment = await prediction_service.assess_customer_risk(customer_id)
        
        # Payment behavior analysis
        payment_behavior = await _analyze_customer_payment_behavior(customer_id)
        
        # Revenue contribution analysis
        revenue_contribution = await _analyze_customer_revenue_contribution(customer_id)
        
        # Generate recommendations
        recommendations = await _generate_customer_recommendations(
            customer, risk_assessment, payment_behavior, revenue_contribution
        )
        
        return CustomerInsightsResponse(
            customer_id=customer_id,
            customer_name=customer.get('customerName', 'Unknown'),
            risk_profile=risk_assessment,
            payment_behavior=payment_behavior,
            revenue_contribution=revenue_contribution,
            recommendations=recommendations
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get customer insights for {customer_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve customer insights"
        )

@router.get("/inventory-analytics", response_model=InventoryAnalyticsResponse)
async def get_inventory_analytics(
    prediction_service: PredictionService = Depends(get_prediction_service)
):
    """Get inventory analytics and recommendations"""
    try:
        items_collection = await get_collection("items")
        total_items = await items_collection.count_documents({"isActive": True})

        low_stock_items = await _get_low_stock_items()
        overstock_items = await _get_overstock_items()
        demand_trends = await _get_demand_trends()
        reorder_recommendations = await _get_reorder_recommendations()

        return InventoryAnalyticsResponse(
            total_items=total_items,
            low_stock_items=low_stock_items,
            overstock_items=overstock_items,
            demand_trends=demand_trends,
            reorder_recommendations=reorder_recommendations
        )

    except Exception as e:
        logger.error(f"Failed to get inventory analytics: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve inventory analytics"
        )

@router.get("/payment-trends")
async def get_payment_trends(
    days_back: int = Query(default=90, ge=1, le=365)
):
    """Get payment trends and patterns from vouchers"""
    try:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_back)
        now = datetime.now()

        # Monthly trends grouped by year-month with status breakdown
        monthly_pipeline = [
            {
                "$match": {
                    "voucherType": "sales",
                    "date": {"$gte": start_date, "$lte": end_date}
                }
            },
            {
                "$group": {
                    "_id": {
                        "year": {"$year": "$date"},
                        "month": {"$month": "$date"}
                    },
                    "total_amount": {"$sum": "$totals.grandTotal"},
                    "total_payments": {"$sum": 1},
                    "paid_count": {
                        "$sum": {"$cond": [{"$eq": ["$status", "paid"]}, 1, 0]}
                    },
                    "pending_count": {
                        "$sum": {"$cond": [{"$eq": ["$status", "pending"]}, 1, 0]}
                    }
                }
            },
            {"$sort": {"_id": 1}}
        ]
        monthly_raw = await aggregate_pipeline("vouchers", monthly_pipeline)

        monthly_trends = []
        for m in monthly_raw:
            yr = m["_id"]["year"]
            mo = m["_id"]["month"]
            month_str = f"{yr}-{mo:02d}"
            total = m["total_payments"]
            paid = m["paid_count"]
            pending = m["pending_count"]
            overdue = total - paid - pending
            monthly_trends.append({
                "month": month_str,
                "total_payments": total,
                "on_time_payments": paid,
                "delayed_payments": pending,
                "overdue_payments": max(0, overdue),
                "total_amount": m["total_amount"]
            })

        # Daily trends
        daily_pipeline = [
            {
                "$match": {
                    "voucherType": "sales",
                    "date": {"$gte": start_date, "$lte": end_date}
                }
            },
            {
                "$group": {
                    "_id": {
                        "year": {"$year": "$date"},
                        "month": {"$month": "$date"},
                        "day": {"$dayOfMonth": "$date"}
                    },
                    "total_amount": {"$sum": "$totals.grandTotal"},
                    "payment_count": {"$sum": 1},
                    "avg_amount": {"$avg": "$totals.grandTotal"}
                }
            },
            {"$sort": {"_id": 1}}
        ]
        daily_trends = await aggregate_pipeline("vouchers", daily_pipeline)

        total_payments = sum(t["payment_count"] for t in daily_trends)
        total_amount = sum(t["total_amount"] for t in daily_trends)
        avg_daily_amount = total_amount / len(daily_trends) if daily_trends else 0

        return {
            "monthly_trends": monthly_trends,
            "trends": daily_trends,
            "summary": {
                "total_payments": total_payments,
                "total_amount": total_amount,
                "average_daily_amount": avg_daily_amount,
                "period_days": days_back
            }
        }

    except Exception as e:
        logger.error(f"Failed to get payment trends: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve payment trends"
        )

@router.get("/risk-dashboard")
async def get_risk_dashboard():
    """Get risk dashboard data"""
    try:
        # High-risk customers
        high_risk_customers = await _get_high_risk_customers()
        
        # Overdue payments
        overdue_payments = await _get_overdue_payments()
        
        # Credit utilization alerts
        credit_alerts = await _get_credit_utilization_alerts()
        
        return {
            "high_risk_customers": high_risk_customers,
            "overdue_payments": overdue_payments,
            "credit_alerts": credit_alerts,
            "summary": {
                "total_high_risk": len(high_risk_customers),
                "total_overdue": len(overdue_payments),
                "total_credit_alerts": len(credit_alerts)
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get risk dashboard: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve risk dashboard"
        )

# Helper functions
async def _get_revenue_forecast(start_date: datetime, end_date: datetime) -> Dict[str, Any]:
    """Get revenue forecast data"""
    try:
        # Current period revenue from sales vouchers
        pipeline = [
            {
                "$match": {
                    "date": {"$gte": start_date, "$lte": end_date},
                    "voucherType": "sales"
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_revenue": {"$sum": "$totals.grandTotal"},
                    "transaction_count": {"$sum": 1},
                    "avg_transaction": {"$avg": "$totals.grandTotal"}
                }
            }
        ]
        revenue_data = await aggregate_pipeline("vouchers", pipeline)
        current_revenue = revenue_data[0] if revenue_data else {
            "total_revenue": 0, "transaction_count": 0, "avg_transaction": 0
        }

        # Previous period revenue for growth rate calculation
        period_days = (end_date - start_date).days
        prev_end = start_date
        prev_start = prev_end - timedelta(days=period_days)
        prev_pipeline = [
            {
                "$match": {
                    "date": {"$gte": prev_start, "$lte": prev_end},
                    "voucherType": "sales"
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_revenue": {"$sum": "$totals.grandTotal"}
                }
            }
        ]
        prev_data = await aggregate_pipeline("vouchers", prev_pipeline)
        prev_revenue = prev_data[0]["total_revenue"] if prev_data else 0

        current_total = current_revenue.get("total_revenue", 0)
        if prev_revenue > 0:
            growth_rate = (current_total - prev_revenue) / prev_revenue
        else:
            growth_rate = 0.0

        # Daily breakdown for chart
        daily_pipeline = [
            {
                "$match": {
                    "date": {"$gte": start_date, "$lte": end_date},
                    "voucherType": "sales"
                }
            },
            {
                "$group": {
                    "_id": {
                        "year": {"$year": "$date"},
                        "month": {"$month": "$date"},
                        "day": {"$dayOfMonth": "$date"}
                    },
                    "actual_revenue": {"$sum": "$totals.grandTotal"},
                    "count": {"$sum": 1}
                }
            },
            {"$sort": {"_id": 1}}
        ]
        daily_data = await aggregate_pipeline("vouchers", daily_pipeline)

        daily_avg = current_total / max(period_days, 1)
        daily_forecast = []
        for d in daily_data:
            date_str = f"{d['_id']['year']}-{d['_id']['month']:02d}-{d['_id']['day']:02d}"
            daily_forecast.append({
                "date": date_str,
                "actual_revenue": d["actual_revenue"],
                "predicted_revenue": daily_avg
            })

        return {
            "current_period": current_revenue,
            "forecast_next_30_days": daily_avg * 30,
            "growth_rate": round(growth_rate, 4),
            "confidence": 0.75,
            "daily_forecast": daily_forecast
        }

    except Exception as e:
        logger.error(f"Error getting revenue forecast: {e}")
        return {"error": str(e), "daily_forecast": []}

async def _get_payment_insights(start_date: datetime, end_date: datetime) -> Dict[str, Any]:
    """Get payment insights from sales vouchers"""
    try:
        pipeline = [
            {
                "$match": {
                    "date": {"$gte": start_date, "$lte": end_date},
                    "voucherType": "sales"
                }
            },
            {
                "$group": {
                    "_id": "$status",
                    "count": {"$sum": 1},
                    "total_amount": {"$sum": "$totals.grandTotal"}
                }
            }
        ]
        payment_status = await aggregate_pipeline("vouchers", pipeline)

        total_payments = sum(p["count"] for p in payment_status)
        paid_count = next((p["count"] for p in payment_status if p["_id"] == "paid"), 0)
        overdue_count_val = next((p["count"] for p in payment_status if p["_id"] in ("overdue", "pending")), 0)
        on_time_rate = (paid_count / total_payments * 100) if total_payments > 0 else 0

        # Count vouchers past due date and not paid
        now = datetime.now()
        overdue_pipeline = [
            {
                "$match": {
                    "voucherType": "sales",
                    "dueDate": {"$lt": now},
                    "status": {"$nin": ["paid", "cancelled"]}
                }
            },
            {"$count": "overdue_count"}
        ]
        overdue_data = await aggregate_pipeline("vouchers", overdue_pipeline)
        overdue_count_val = overdue_data[0]["overdue_count"] if overdue_data else 0

        return {
            "total_payments": total_payments,
            "on_time_rate": round(on_time_rate, 2),
            "overdue_count": overdue_count_val,
            "status_distribution": payment_status
        }

    except Exception as e:
        logger.error(f"Error getting payment insights: {e}")
        return {"error": str(e)}

async def _get_customer_analytics(start_date: datetime, end_date: datetime) -> Dict[str, Any]:
    """Get customer analytics"""
    try:
        parties_collection = await get_collection("parties")
        total_customers = await parties_collection.count_documents({"type": {"$in": ["customer", "both"]}})

        # Active customers with recent sales transactions
        pipeline = [
            {
                "$match": {
                    "date": {"$gte": start_date, "$lte": end_date},
                    "voucherType": "sales"
                }
            },
            {
                "$group": {
                    "_id": "$partyName",
                    "transaction_count": {"$sum": 1},
                    "total_amount": {"$sum": "$totals.grandTotal"}
                }
            }
        ]
        active_customers = await aggregate_pipeline("vouchers", pipeline)

        return {
            "total_customers": total_customers,
            "active_customers": len(active_customers),
            "top_customers": sorted(active_customers, key=lambda x: x.get("total_amount", 0), reverse=True)[:10]
        }

    except Exception as e:
        logger.error(f"Error getting customer analytics: {e}")
        return {"error": str(e)}

async def _get_inventory_insights() -> Dict[str, Any]:
    """Get inventory insights"""
    try:
        items_collection = await get_collection("items")
        total_items = await items_collection.count_documents({"inventory.trackInventory": True})

        # Aggregate stock totals and low-stock count
        pipeline = [
            {"$match": {"inventory.trackInventory": True}},
            {
                "$addFields": {
                    "totalStock": {"$sum": "$inventory.currentStock.quantity"}
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total_items": {"$sum": 1},
                    "total_stock": {"$sum": "$totalStock"},
                    "avg_stock": {"$avg": "$totalStock"},
                    "low_stock_count": {
                        "$sum": {
                            "$cond": [
                                {"$lte": ["$totalStock", "$inventory.stockLevels.reorderLevel"]},
                                1, 0
                            ]
                        }
                    }
                }
            }
        ]
        inventory_stats = await aggregate_pipeline("items", pipeline)
        stats = inventory_stats[0] if inventory_stats else {}

        return {
            "total_items": stats.get("total_items", total_items),
            "total_stock_units": stats.get("total_stock", 0),
            "low_stock_items": stats.get("low_stock_count", 0),
            "average_stock_level": round(stats.get("avg_stock", 0), 2)
        }

    except Exception as e:
        logger.error(f"Error getting inventory insights: {e}")
        return {"error": str(e)}

async def _get_risk_summary() -> Dict[str, Any]:
    """Get risk summary"""
    try:
        pipeline = [
            {
                "$match": {
                    "type": {"$in": ["customer", "both"]},
                    "creditLimit.amount": {"$gt": 0}
                }
            },
            {
                "$addFields": {
                    "utilization_ratio": {
                        "$cond": [
                            {"$gt": ["$creditLimit.amount", 0]},
                            {"$divide": ["$balances.current.amount", "$creditLimit.amount"]},
                            0
                        ]
                    }
                }
            },
            {
                "$match": {
                    "utilization_ratio": {"$gt": 0.8}
                }
            },
            {
                "$count": "high_utilization_count"
            }
        ]
        high_utilization = await aggregate_pipeline("parties", pipeline)
        high_utilization_count = high_utilization[0]["high_utilization_count"] if high_utilization else 0

        # Count overdue vouchers
        now = datetime.now()
        overdue_pipeline = [
            {
                "$match": {
                    "voucherType": "sales",
                    "dueDate": {"$lt": now},
                    "status": {"$nin": ["paid", "cancelled"]}
                }
            },
            {"$count": "overdue_count"}
        ]
        overdue_data = await aggregate_pipeline("vouchers", overdue_pipeline)
        overdue_count = overdue_data[0]["overdue_count"] if overdue_data else 0

        return {
            "high_credit_utilization": high_utilization_count,
            "overdue_vouchers": overdue_count,
            "risk_level": "High" if high_utilization_count > 10 else ("Medium" if high_utilization_count > 3 else "Low")
        }

    except Exception as e:
        logger.error(f"Error getting risk summary: {e}")
        return {"error": str(e)}

# Additional helper functions would be implemented here...
async def _analyze_customer_payment_behavior(customer_id: str) -> Dict[str, Any]:
    """Analyze customer payment behavior"""
    # Placeholder implementation
    return {
        "average_delay_days": 5,
        "payment_frequency": "Monthly",
        "preferred_method": "Bank Transfer",
        "reliability_score": 0.85
    }

async def _analyze_customer_revenue_contribution(customer_id: str) -> Dict[str, Any]:
    """Analyze customer revenue contribution"""
    # Placeholder implementation
    return {
        "total_revenue": 50000,
        "average_order_value": 2500,
        "order_frequency": "Bi-weekly",
        "growth_trend": "Increasing"
    }

async def _generate_customer_recommendations(customer, risk_assessment, payment_behavior, revenue_contribution) -> List[str]:
    """Generate customer-specific recommendations"""
    recommendations = []
    
    if risk_assessment.get("risk_level") == "High":
        recommendations.append("Consider requiring advance payment or reducing credit limit")
    
    if payment_behavior.get("average_delay_days", 0) > 7:
        recommendations.append("Implement automated payment reminders")
    
    if revenue_contribution.get("growth_trend") == "Decreasing":
        recommendations.append("Engage with customer to understand needs and improve relationship")
    
    return recommendations

async def _get_low_stock_items() -> List[Dict[str, Any]]:
    """Get low stock items from items collection"""
    try:
        pipeline = [
            {"$match": {"inventory.trackInventory": True, "isActive": True}},
            {
                "$addFields": {
                    "totalStock": {"$sum": "$inventory.currentStock.quantity"}
                }
            },
            {
                "$match": {
                    "$expr": {"$lte": ["$totalStock", "$inventory.stockLevels.reorderLevel"]}
                }
            },
            {
                "$project": {
                    "item_name": {"$ifNull": ["$displayName", "$name"]},
                    "current_stock": "$totalStock",
                    "reorder_level": "$inventory.stockLevels.reorderLevel",
                    "reorder_quantity": "$inventory.stockLevels.reorderQuantity",
                    "unit": "$units.primary.name"
                }
            },
            {"$limit": 50}
        ]
        return await aggregate_pipeline("items", pipeline)
    except Exception as e:
        logger.error(f"Error getting low stock items: {e}")
        return []

async def _get_overstock_items() -> List[Dict[str, Any]]:
    """Get overstock items (stock > maximum level)"""
    try:
        pipeline = [
            {
                "$match": {
                    "inventory.trackInventory": True,
                    "isActive": True,
                    "inventory.stockLevels.maximum": {"$gt": 0}
                }
            },
            {
                "$addFields": {
                    "totalStock": {"$sum": "$inventory.currentStock.quantity"}
                }
            },
            {
                "$match": {
                    "$expr": {"$gt": ["$totalStock", "$inventory.stockLevels.maximum"]}
                }
            },
            {
                "$project": {
                    "item_name": {"$ifNull": ["$displayName", "$name"]},
                    "current_stock": "$totalStock",
                    "maximum_level": "$inventory.stockLevels.maximum",
                    "unit": "$units.primary.name"
                }
            },
            {"$limit": 50}
        ]
        return await aggregate_pipeline("items", pipeline)
    except Exception as e:
        logger.error(f"Error getting overstock items: {e}")
        return []

async def _get_demand_trends() -> List[Dict[str, Any]]:
    """Get demand trends from recent sales voucher items"""
    try:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=90)
        pipeline = [
            {
                "$match": {
                    "voucherType": "sales",
                    "date": {"$gte": start_date, "$lte": end_date}
                }
            },
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": "$items.itemName",
                    "total_quantity": {"$sum": "$items.quantity"},
                    "total_revenue": {"$sum": "$items.amount"},
                    "order_count": {"$sum": 1}
                }
            },
            {"$sort": {"total_quantity": -1}},
            {
                "$project": {
                    "item_name": "$_id",
                    "total_quantity": 1,
                    "total_revenue": 1,
                    "order_count": 1,
                    "predicted_demand": {"$round": [{"$divide": ["$total_quantity", 3]}, 0]}
                }
            },
            {"$limit": 20}
        ]
        return await aggregate_pipeline("vouchers", pipeline)
    except Exception as e:
        logger.error(f"Error getting demand trends: {e}")
        return []

async def _get_reorder_recommendations() -> List[Dict[str, Any]]:
    """Get reorder recommendations for items near or below reorder level"""
    try:
        pipeline = [
            {
                "$match": {
                    "inventory.trackInventory": True,
                    "isActive": True,
                    "inventory.stockLevels.reorderLevel": {"$gt": 0}
                }
            },
            {
                "$addFields": {
                    "totalStock": {"$sum": "$inventory.currentStock.quantity"}
                }
            },
            {
                "$match": {
                    "$expr": {"$lte": ["$totalStock", {"$multiply": ["$inventory.stockLevels.reorderLevel", 1.2]}]}
                }
            },
            {
                "$project": {
                    "item_name": {"$ifNull": ["$displayName", "$name"]},
                    "current_stock": "$totalStock",
                    "reorder_level": "$inventory.stockLevels.reorderLevel",
                    "reorder_quantity": "$inventory.stockLevels.reorderQuantity",
                    "unit": "$units.primary.name",
                    "urgency": {
                        "$cond": [
                            {"$lte": ["$totalStock", "$inventory.stockLevels.minimum"]},
                            "urgent", "normal"
                        ]
                    }
                }
            },
            {"$sort": {"current_stock": 1}},
            {"$limit": 20}
        ]
        return await aggregate_pipeline("items", pipeline)
    except Exception as e:
        logger.error(f"Error getting reorder recommendations: {e}")
        return []

async def _get_high_risk_customers() -> List[Dict[str, Any]]:
    """Get high-risk customers based on credit utilization and overdue payments"""
    try:
        pipeline = [
            {
                "$match": {
                    "type": {"$in": ["customer", "both"]},
                    "isActive": True,
                    "creditLimit.amount": {"$gt": 0}
                }
            },
            {
                "$addFields": {
                    "utilization_ratio": {
                        "$cond": [
                            {"$gt": ["$creditLimit.amount", 0]},
                            {"$divide": ["$balances.current.amount", "$creditLimit.amount"]},
                            0
                        ]
                    }
                }
            },
            {
                "$match": {"utilization_ratio": {"$gt": 0.7}}
            },
            {
                "$project": {
                    "customer_name": {"$ifNull": ["$displayName", "$name"]},
                    "outstanding_amount": "$balances.current.amount",
                    "credit_limit": "$creditLimit.amount",
                    "utilization_ratio": {"$round": ["$utilization_ratio", 2]},
                    "risk_level": {
                        "$cond": [
                            {"$gte": ["$utilization_ratio", 0.9]}, "High",
                            {"$cond": [{"$gte": ["$utilization_ratio", 0.7]}, "Medium", "Low"]}
                        ]
                    }
                }
            },
            {"$sort": {"utilization_ratio": -1}},
            {"$limit": 20}
        ]
        return await aggregate_pipeline("parties", pipeline)
    except Exception as e:
        logger.error(f"Error getting high risk customers: {e}")
        return []

async def _get_overdue_payments() -> List[Dict[str, Any]]:
    """Get overdue sales vouchers"""
    try:
        now = datetime.now()
        pipeline = [
            {
                "$match": {
                    "voucherType": "sales",
                    "dueDate": {"$lt": now},
                    "status": {"$nin": ["paid", "cancelled"]}
                }
            },
            {
                "$addFields": {
                    "days_overdue": {
                        "$divide": [
                            {"$subtract": [now, "$dueDate"]},
                            86400000
                        ]
                    }
                }
            },
            {
                "$project": {
                    "party_name": "$partyName",
                    "voucher_number": "$voucherNumber",
                    "amount": "$totals.grandTotal",
                    "due_date": "$dueDate",
                    "days_overdue": {"$round": ["$days_overdue", 0]},
                    "status": 1
                }
            },
            {"$sort": {"days_overdue": -1}},
            {"$limit": 50}
        ]
        return await aggregate_pipeline("vouchers", pipeline)
    except Exception as e:
        logger.error(f"Error getting overdue payments: {e}")
        return []

async def _get_credit_utilization_alerts() -> List[Dict[str, Any]]:
    """Get customers with credit utilization above 90%"""
    try:
        pipeline = [
            {
                "$match": {
                    "type": {"$in": ["customer", "both"]},
                    "isActive": True,
                    "creditLimit.amount": {"$gt": 0}
                }
            },
            {
                "$addFields": {
                    "utilization_ratio": {
                        "$cond": [
                            {"$gt": ["$creditLimit.amount", 0]},
                            {"$divide": ["$balances.current.amount", "$creditLimit.amount"]},
                            0
                        ]
                    }
                }
            },
            {"$match": {"utilization_ratio": {"$gte": 0.9}}},
            {
                "$project": {
                    "customer_name": {"$ifNull": ["$displayName", "$name"]},
                    "outstanding_amount": "$balances.current.amount",
                    "credit_limit": "$creditLimit.amount",
                    "utilization_pct": {"$round": [{"$multiply": ["$utilization_ratio", 100]}, 1]},
                    "alert_level": "Critical"
                }
            },
            {"$sort": {"utilization_ratio": -1}},
            {"$limit": 20}
        ]
        return await aggregate_pipeline("parties", pipeline)
    except Exception as e:
        logger.error(f"Error getting credit utilization alerts: {e}")
        return []
